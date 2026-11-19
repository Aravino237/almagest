"""Fine-tune a pretrained CNN on Galaxy10 DECaLS (real galaxy photos, Galaxy Zoo labels).

Honest-evaluation design:
  * stratified 80/10/10 train/val/test split with a fixed seed;
  * the test set is touched exactly once, after training, with the best-on-validation weights;
  * temperature scaling is fitted on the validation set only, so reported confidence is calibrated;
  * macro-F1 is reported next to accuracy because the classes are imbalanced (class 4 has 334 images).

Usage (from this folder):
    python train.py                      # defaults: resnet18, 128 px, 30 epochs
    python train.py --arch efficientnet_b0 --size 160 --epochs 40
"""
import argparse, json, os, time
import numpy as np, h5py, torch, torch.nn as nn, torch.nn.functional as F, torchvision

CLASSES = ["Disturbed", "Merging", "Round smooth", "In-between round smooth", "Cigar smooth",
           "Barred spiral", "Unbarred tight spiral", "Unbarred loose spiral", "Edge-on, no bulge", "Edge-on, with bulge"]
HERE = os.path.dirname(os.path.abspath(__file__))

p = argparse.ArgumentParser()
p.add_argument("--data", default=os.path.join(HERE, "data", "Galaxy10_DECals.h5"))
p.add_argument("--arch", default="resnet18", choices=["resnet18", "resnet34", "efficientnet_b0", "mobilenet_v3_large"])
p.add_argument("--size", type=int, default=128)
p.add_argument("--epochs", type=int, default=30)
p.add_argument("--batch", type=int, default=64)
p.add_argument("--lr", type=float, default=1e-3)
p.add_argument("--seed", type=int, default=0)
p.add_argument("--limit", type=int, default=None, help="use only N images (for quick tests)")
p.add_argument("--no-pretrained", action="store_true", help="train from scratch (use if offline)")
p.add_argument("--out", default=os.path.join(HERE, "runs", "latest"))
p.add_argument("--export-dir", default=os.path.join(HERE, "..", "models"))
args = p.parse_args()

torch.manual_seed(args.seed); np.random.seed(args.seed)
dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"device: {dev}" + (f" ({torch.cuda.get_device_name(0)}, {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB)" if dev.type == "cuda" else "  (no GPU found: this will be slow)"))
os.makedirs(args.out, exist_ok=True)

# ---------------- data ----------------
def load(path, size, limit, seed):
    with h5py.File(path, "r") as f:
        labels = np.asarray(f["ans"][:], dtype=np.int64); n = len(labels)
        idx = np.arange(n)
        if limit and limit < n:
            rng = np.random.default_rng(seed)
            idx = np.sort(np.concatenate([rng.permutation(np.where(labels == c)[0])[: max(2, limit // 10)] for c in range(10)]))
        imgs = np.empty((len(idx), 3, size, size), np.uint8)
        t, out = time.time(), 0
        for s in range(0, n, 512):
            sel = idx[(idx >= s) & (idx < s + 512)]
            if not len(sel): continue
            blk = torch.from_numpy(f["images"][s:s + 512][sel - s]).permute(0, 3, 1, 2).float()
            blk = F.interpolate(blk, size=(size, size), mode="bilinear", antialias=True, align_corners=False)
            imgs[out:out + len(sel)] = blk.round().clamp(0, 255).byte().numpy(); out += len(sel)
            print(f"\rloading {out}/{len(idx)} ({time.time() - t:.0f}s)", end="", flush=True)
    print()
    return torch.from_numpy(imgs), torch.from_numpy(labels[idx])

X, y = load(args.data, args.size, args.limit, args.seed)
print(f"{len(y)} images, class counts: {np.bincount(y.numpy(), minlength=10).tolist()}")

def stratified_split(y, seed, fr=(0.8, 0.1, 0.1)):
    rng = np.random.default_rng(seed); tr, va, te = [], [], []
    for c in range(10):
        ids = rng.permutation(np.where(y.numpy() == c)[0]); a = int(len(ids) * fr[0]); b = a + max(1, int(len(ids) * fr[1]))
        tr += ids[:a].tolist(); va += ids[a:b].tolist(); te += ids[b:].tolist()
    return map(torch.tensor, (tr, va, te))
itr, iva, ite = stratified_split(y, args.seed)
print(f"split: train {len(itr)} / val {len(iva)} / test {len(ite)}")
counts = torch.bincount(y[itr], minlength=10).float()
cls_w = ((counts.sum() / counts) ** 0.5); cls_w = (cls_w / cls_w.mean()).to(dev)

# ---------------- model ----------------
class Net(nn.Module):
    """Input: float RGB in [0,1], NCHW. ImageNet normalisation and temperature are inside the model,
    so the exported ONNX file takes plain pixels and returns calibrated probabilities."""
    def __init__(self, arch, pretrained):
        super().__init__()
        w = "DEFAULT" if pretrained else None
        if arch.startswith("resnet"):
            self.body = getattr(torchvision.models, arch)(weights=w); self.body.fc = nn.Linear(self.body.fc.in_features, 10)
        elif arch == "efficientnet_b0":
            self.body = torchvision.models.efficientnet_b0(weights=w); self.body.classifier[1] = nn.Linear(self.body.classifier[1].in_features, 10)
        else:
            self.body = torchvision.models.mobilenet_v3_large(weights=w); self.body.classifier[3] = nn.Linear(self.body.classifier[3].in_features, 10)
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
        self.register_buffer("temperature", torch.ones(1))
        self.probs = False
    def logits(self, x): return self.body((x - self.mean) / self.std)
    def forward(self, x):
        z = self.logits(x) / self.temperature
        return F.softmax(z, 1) if self.probs else z

try:
    model = Net(args.arch, not args.no_pretrained)
except Exception as e:
    print(f"could not load pretrained weights ({e}); training from scratch")
    model = Net(args.arch, False)
model = model.to(dev).to(memory_format=torch.channels_last)

def augment(x):
    """Galaxies have no preferred orientation: random rotation, flip, scale, shift, brightness (all on the GPU)."""
    B = x.size(0); a = torch.rand(B, device=x.device) * 2 * np.pi
    s = 1 / (0.9 + 0.2 * torch.rand(B, device=x.device)); f = torch.where(torch.rand(B, device=x.device) < 0.5, -1.0, 1.0)
    t = (torch.rand(B, 2, device=x.device) - 0.5) * 0.1
    th = torch.stack([torch.stack([s * a.cos() * f, -s * a.sin(), t[:, 0]], 1), torch.stack([s * a.sin() * f, s * a.cos(), t[:, 1]], 1)], 1)
    x = F.grid_sample(x, F.affine_grid(th, x.shape, align_corners=False), padding_mode="reflection", align_corners=False)
    return (x * (0.9 + 0.2 * torch.rand(B, 1, 1, 1, device=x.device))).clamp(0, 1)

@torch.no_grad()
def logits_of(idx, tta):
    model.eval(); out = []
    for i in range(0, len(idx), 128):
        xb = (X[idx[i:i + 128]].to(dev).float() / 255).contiguous(memory_format=torch.channels_last)
        views = [xb] if not tta else [torch.rot90(v, k, (2, 3)) for v in (xb, xb.flip(3)) for k in range(4)]
        with torch.autocast(dev.type, enabled=dev.type == "cuda"):
            z = torch.stack([model.logits(v).float() for v in views]).mean(0)
        out.append(z.cpu())
    return torch.cat(out)

def metrics(z, yt):
    pred = z.argmax(1); acc = (pred == yt).float().mean().item()
    cm = torch.zeros(10, 10, dtype=torch.long)
    for a, b in zip(yt, pred): cm[a, b] += 1
    prec = cm.diag().float() / cm.sum(0).clamp(min=1); rec = cm.diag().float() / cm.sum(1).clamp(min=1)
    f1 = 2 * prec * rec / (prec + rec).clamp(min=1e-9)
    pr = F.softmax(z, 1); conf, _ = pr.max(1); ok = (pred == yt).float(); ece = 0.0
    for lo in np.linspace(0, 1, 16)[:-1]:
        m = (conf > lo) & (conf <= lo + 1 / 15)
        if m.any(): ece += m.float().mean().item() * abs(ok[m].mean().item() - conf[m].mean().item())
    return dict(accuracy=acc, macro_f1=f1.mean().item(), ece=ece, nll=F.cross_entropy(z, yt).item(),
                per_class={CLASSES[i]: dict(precision=prec[i].item(), recall=rec[i].item(), f1=f1[i].item(), n=int(cm[i].sum())) for i in range(10)},
                confusion=cm.tolist())

# ---------------- train ----------------
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
steps = args.epochs * (len(itr) // args.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.15)
scaler = torch.amp.GradScaler(enabled=dev.type == "cuda")
crit = nn.CrossEntropyLoss(weight=cls_w, label_smoothing=0.1)
hist, best, best_state = [], -1, None
yd = y
for ep in range(args.epochs):
    model.train(); perm = itr[torch.randperm(len(itr))]; t0 = time.time(); tl = 0; nb = 0
    for i in range(0, len(perm) - args.batch + 1, args.batch):
        b = perm[i:i + args.batch]
        xb = augment((X[b].to(dev, non_blocking=True).float() / 255)).contiguous(memory_format=torch.channels_last); yb = yd[b].to(dev)
        with torch.autocast(dev.type, enabled=dev.type == "cuda"):
            loss = crit(model.logits(xb).float(), yb)
        opt.zero_grad(set_to_none=True); scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
        tl += loss.item(); nb += 1
    m = metrics(logits_of(iva, False), y[iva])
    hist.append(dict(epoch=ep + 1, train_loss=tl / nb, val_acc=m["accuracy"], val_macro_f1=m["macro_f1"]))
    flag = ""
    if m["macro_f1"] > best:
        best = m["macro_f1"]; best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}; flag = "  *best"
    print(f"epoch {ep + 1:2d}/{args.epochs}  loss {tl / nb:.3f}  val acc {m['accuracy']:.3f}  val macro-F1 {m['macro_f1']:.3f}  ({time.time() - t0:.0f}s){flag}")

# ---------------- calibrate on validation, evaluate once on test ----------------
model.load_state_dict(best_state)
zv = logits_of(iva, True)
T = nn.Parameter(torch.ones(1)); lb = torch.optim.LBFGS([T], lr=0.1, max_iter=100)
def closure():
    lb.zero_grad(); l = F.cross_entropy(zv / T.clamp(min=0.05), y[iva]); l.backward(); return l
lb.step(closure); model.temperature.copy_(T.detach().clamp(min=0.05).to(dev))
print(f"temperature fitted on validation set: {model.temperature.item():.3f}")
zt = logits_of(ite, True) / model.temperature.item()
res = metrics(zt, y[ite]); res_plain = metrics(logits_of(ite, False) / model.temperature.item(), y[ite])
res.update(args=vars(args), temperature=model.temperature.item(), n_train=len(itr), n_val=len(iva), n_test=len(ite),
           accuracy_no_tta=res_plain["accuracy"], history=hist, classes=CLASSES, device=str(dev))
print(f"\nTEST (held out, n={len(ite)}):  accuracy {res['accuracy']:.4f}  macro-F1 {res['macro_f1']:.4f}  ECE {res['ece']:.4f}  (accuracy without TTA {res['accuracy_no_tta']:.4f})")
for k, v in res["per_class"].items(): print(f"  {k:26s} P {v['precision']:.2f}  R {v['recall']:.2f}  F1 {v['f1']:.2f}  n={v['n']}")
json.dump(res, open(os.path.join(args.out, "results.json"), "w"), indent=1)
torch.save(best_state, os.path.join(args.out, "best.pt"))

# ---------------- figures ----------------
try:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(10, 3.4))
    ax[0].plot([h["train_loss"] for h in hist]); ax[0].set_xlabel("epoch"); ax[0].set_ylabel("training loss")
    ax[1].plot([h["val_acc"] for h in hist], label="val accuracy"); ax[1].plot([h["val_macro_f1"] for h in hist], label="val macro-F1"); ax[1].legend(); ax[1].set_xlabel("epoch")
    plt.tight_layout(); plt.savefig(os.path.join(args.out, "curves.png"), dpi=160); plt.close()
    cm = np.array(res["confusion"]); fig, a = plt.subplots(figsize=(7, 6)); a.imshow(cm / cm.sum(1, keepdims=True).clip(1), cmap="Blues")
    a.set_xticks(range(10)); a.set_yticks(range(10)); a.set_xticklabels(range(10)); a.set_yticklabels([f"{i} {c}" for i, c in enumerate(CLASSES)], fontsize=7)
    for i in range(10):
        for j in range(10): a.text(j, i, cm[i, j], ha="center", va="center", fontsize=7, color="w" if cm[i, j] > cm[i].max() * 0.6 else "k")
    a.set_xlabel("predicted class"); a.set_ylabel("true class"); plt.tight_layout(); plt.savefig(os.path.join(args.out, "confusion.png"), dpi=160); plt.close()
except Exception as e:
    print("figures skipped:", e)

# ---------------- export for the Almagest server ----------------
model.eval().cpu(); model.probs = True
dummy = torch.rand(1, 3, args.size, args.size)
os.makedirs(args.export_dir, exist_ok=True); onnx_path = os.path.join(args.export_dir, "galaxy10.onnx")
try:
    torch.onnx.export(model, dummy, onnx_path, input_names=["pixels"], output_names=["probs"], opset_version=17,
                      dynamic_axes={"pixels": {0: "batch"}, "probs": {0: "batch"}}, dynamo=False)
except Exception as e:   # newer/older PyTorch: fall back to the default exporter
    print("legacy ONNX exporter unavailable, using default:", str(e)[:80])
    torch.onnx.export(model, dummy, onnx_path, input_names=["pixels"], output_names=["probs"], opset_version=17, dynamic_axes={"pixels": {0: "batch"}, "probs": {0: "batch"}})
json.dump(dict(classes=CLASSES, size=args.size, arch=args.arch, temperature=res["temperature"], dataset="Galaxy10 DECaLS",
               test_accuracy=res["accuracy"], test_macro_f1=res["macro_f1"], ece=res["ece"], n_test=res["n_test"]),
          open(os.path.join(args.export_dir, "galaxy10.json"), "w"), indent=1)
try:   # parity check: ONNX output must match PyTorch
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    with torch.no_grad(): ref = model(dummy).numpy()
    diff = float(np.abs(sess.run(None, {"pixels": dummy.numpy()})[0] - ref).max())
    print(f"ONNX export OK, max |onnx - torch| = {diff:.2e}")
    assert diff < 1e-3
except ImportError:
    print("onnxruntime not installed: skipped the ONNX parity check")
print("exported:", os.path.abspath(onnx_path))
