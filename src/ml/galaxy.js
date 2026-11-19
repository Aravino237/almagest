// Galaxy-morphology classifier (ONNX, trained offline on Galaxy10 DECaLS: see ml-galaxy/).
// The model file is optional: if models/galaxy10.onnx is missing the API reports "not installed".
const fs = require("fs");
const path = require("path");

const DIR = process.env.GALAXY_MODEL_DIR || path.join(__dirname, "..", "..", "models");
let state = null; // { session, meta, ort }

async function load() {
  if (state) return state;
  const onnxPath = path.join(DIR, "galaxy10.onnx"), metaPath = path.join(DIR, "galaxy10.json");
  if (!fs.existsSync(onnxPath) || !fs.existsSync(metaPath)) return null;
  let ort;
  try { ort = require("onnxruntime-node"); } catch { return null; }
  state = { ort, meta: JSON.parse(fs.readFileSync(metaPath, "utf8")), session: await ort.InferenceSession.create(onnxPath) };
  return state;
}

async function status() {
  const s = await load();
  if (!s) return { available: false };
  const m = s.meta;
  return { available: true, size: m.size, classes: m.classes, dataset: m.dataset, arch: m.arch,
    testAccuracy: m.test_accuracy, testMacroF1: m.test_macro_f1, ece: m.ece, nTest: m.n_test };
}

// rgb: Uint8Array of size*size*3 (HWC, as read from a canvas). Returns probabilities sorted high to low.
async function classify(rgb) {
  const s = await load();
  if (!s) return null;
  const n = s.meta.size;
  if (rgb.length !== n * n * 3) throw Object.assign(new Error(`Expected ${n}x${n} RGB pixels (${n * n * 3} bytes)`), { status: 400 });
  const chw = new Float32Array(3 * n * n);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) chw[c * n * n + i] = rgb[i * 3 + c] / 255;
  const out = await s.session.run({ pixels: new s.ort.Tensor("float32", chw, [1, 3, n, n]) });
  const probs = Array.from(out.probs.data);
  return probs.map((p, i) => ({ label: s.meta.classes[i], index: i, probability: p })).sort((a, b) => b.probability - a.probability);
}

module.exports = { status, classify };
