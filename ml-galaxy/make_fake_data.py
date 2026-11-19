"""Writes a small FAKE file with the same layout as Galaxy10_DECals.h5 (images, ans) so train.py
can be smoke-tested without the 2.5 GB download. These images are NOT real galaxies."""
import h5py, numpy as np, sys
n = int(sys.argv[1]) if len(sys.argv) > 1 else 600
rng = np.random.default_rng(0); yy, xx = np.mgrid[0:256, 0:256] - 128.0
imgs = np.zeros((n, 256, 256, 3), np.uint8); ans = (np.arange(n) % 10).astype(np.int64)
for i, c in enumerate(ans):
    a = rng.uniform(0, np.pi); sx, sy = 10 + 6 * c, 10 + 3 * (9 - c)
    u = xx * np.cos(a) + yy * np.sin(a); v = -xx * np.sin(a) + yy * np.cos(a)
    g = np.exp(-(u ** 2 / (2 * sx ** 2) + v ** 2 / (2 * sy ** 2))) * 200 + rng.normal(20, 6, (256, 256))
    imgs[i] = np.clip(np.stack([g, g * 0.9, g * 0.8], -1), 0, 255)
with h5py.File("fake_galaxy10.h5", "w") as f: f["images"] = imgs; f["ans"] = ans
print("wrote fake_galaxy10.h5", imgs.shape)
