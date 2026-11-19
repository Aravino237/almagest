// Almagest sky-object classifier — pure JS inference for the trained MLP.
// Input: Float32Array/Array of 32*32 grayscale values in [0,1] (already auto-stretched).
// Works in the browser (window.AlmagestClassifier) and in Node (module.exports).
(function (root) {
  function softmax(v) {
    const m = Math.max(...v); const e = v.map(x => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0);
    return e.map(x => x / s);
  }
  function predict(model, pixels) {
    let a = new Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) a[i] = (pixels[i] - model.mean[i]) / model.std[i];
    model.layers.forEach((L, li) => {
      const out = new Array(L.b.length);
      for (let o = 0; o < out.length; o++) {
        let s = L.b[o]; const w = L.W[o];
        for (let i = 0; i < a.length; i++) s += w[i] * a[i];
        out[o] = li < model.layers.length - 1 ? Math.max(0, s) : s;   // ReLU on hidden layers
      }
      a = out;
    });
    const probs = softmax(a);
    return model.classes.map((c, i) => ({ label: c, p: probs[i] })).sort((x, y) => y.p - x.p);
  }
  // RGBA canvas ImageData (any size) -> 32x32 grayscale, auto-stretched, same as training.
  function preprocess(imageData) {
    const { width: w, height: h, data } = imageData; const n = 32;
    const g = new Float32Array(n * n); const cnt = new Float32Array(n * n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      const j = Math.min(n - 1, Math.floor(y * n / h)) * n + Math.min(n - 1, Math.floor(x * n / w));
      g[j] += lum; cnt[j]++;
    }
    let mx = 1e-6; for (let j = 0; j < g.length; j++) { g[j] /= Math.max(cnt[j], 1); if (g[j] > mx) mx = g[j]; }
    for (let j = 0; j < g.length; j++) g[j] /= mx;
    return g;
  }
  const api = { predict, preprocess };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AlmagestClassifier = api;
})(typeof window !== "undefined" ? window : this);
