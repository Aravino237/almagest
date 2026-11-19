// Minimal NLP toolkit: tokeniser, light stemmer, TF-IDF vectors, cosine similarity.
const STOP = new Set("a an the is are was were be to of in on at for and or me my i can could would should do does it its this that there what whats which with about any some please tell show give let us we you your tonight".split(" "));
const stem = (w) => w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w;
const tokens = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem);

class Tfidf {
  constructor(docs) {
    this.n = docs.length; this.df = new Map();
    for (const d of docs) for (const t of new Set(tokens(d))) this.df.set(t, (this.df.get(t) || 0) + 1);
  }
  idf(t) { return Math.log((1 + this.n) / (1 + (this.df.get(t) || 0))) + 1; }
  vec(text) {
    const tf = new Map();
    for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + 1);
    let norm = 0; const v = new Map();
    for (const [t, c] of tf) { const w = (1 + Math.log(c)) * this.idf(t); v.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  }
}
const cosine = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) { const o = y.get(t); if (o) s += w * o; } return s; };
const centroid = (vs) => { const c = new Map(); for (const v of vs) for (const [t, w] of v) c.set(t, (c.get(t) || 0) + w / vs.length); let n = 0; for (const w of c.values()) n += w * w; n = Math.sqrt(n) || 1; for (const [t, w] of c) c.set(t, w / n); return c; };
module.exports = { tokens, Tfidf, cosine, centroid };
