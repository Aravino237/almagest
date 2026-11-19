// Feature space and the logistic model used by the recommender.
//
// p(enjoy | user u, object o, context c) = sigmoid( (w_global + delta_u) · x(o, c, u) )
//
// w_global is shared across users and learned from everyone's feedback; delta_u is a
// per-user offset pulled toward zero by an L2 penalty, so a new user starts at the
// population model and moves away from it only as fast as their own evidence allows.
// The global weights are in turn pulled toward an astronomy-informed prior, so the
// system makes sensible recommendations before anyone has rated anything.

const TYPES = ["galaxy", "nebula", "globular_cluster", "open_cluster", "planetary_nebula", "double_star", "planet"];
const FEATURES = [
  "bias",
  ...TYPES.map((t) => "type:" + t),
  "altitude",        // (alt - 15) / 75: higher means less atmosphere and better views
  "reach_margin",    // how far inside the instrument's limiting magnitude
  "moon_glare",      // moon brightness x moon above horizon x angular proximity x faintness
  "surface_dimness", // low surface brightness objects suffer most from light pollution
  "apparent_size",   // log size: big objects suit binoculars, tiny ones suit high power
  "novelty",         // 1 if the user has never rated or logged this object
  "beginner_faint",  // faintness x (1 - experience): faint targets frustrate beginners
];
const DIM = FEATURES.length;

const PRIOR = {
  bias: -0.2, altitude: 2.0, reach_margin: 1.2, moon_glare: -2.5, surface_dimness: -0.8,
  apparent_size: 0.2, novelty: 0.3, beginner_faint: -1.5,
};
function priorWeights() { return FEATURES.map((f) => PRIOR[f] ?? 0); }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const EXP = { beginner: 0, intermediate: 0.5, advanced: 1 };

// ctx: { alt, mag, limitMag, moonIllum, moonAlt, moonSepDeg, bortle, experience, seen }
function featurize(obj, ctx) {
  const x = new Array(DIM).fill(0);
  x[0] = 1;
  x[1 + TYPES.indexOf(obj.type)] = 1;
  const faint = clamp((ctx.mag - 3) / 7, 0, 1);
  // Mean surface brightness proxy (mag/arcmin^2) for extended objects; planets and stars are point-like.
  const extended = !["planet", "double_star"].includes(obj.type);
  const sb = extended ? ctx.mag + 2.5 * Math.log10(Math.max(0.01, Math.PI * (obj.size_arcmin / 2) ** 2)) : ctx.mag;
  x[8] = clamp((ctx.alt - 15) / 75, -0.2, 1);
  x[9] = clamp((ctx.limitMag - ctx.mag) / 5, -1, 2);
  const moonUp = ctx.moonAlt > 0 ? 1 : 0.15;
  const proximity = Math.exp(-ctx.moonSepDeg / 50);
  x[10] = ctx.moonIllum * moonUp * (0.4 + 0.6 * proximity) * faint;
  x[11] = extended ? clamp((sb - 10) / 6, 0, 1.5) * (ctx.bortle / 9) : 0;
  x[12] = clamp(Math.log10(obj.size_arcmin + 0.1) / 2.8, -0.4, 1);
  x[13] = ctx.seen ? 0 : 1;
  x[14] = faint * (1 - (EXP[ctx.experience] ?? 0));
  return x.map((v) => Math.round(v * 1e4) / 1e4);
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const add = (a, b) => a.map((v, i) => v + b[i]);

function predict(wGlobal, delta, x) { return sigmoid(dot(add(wGlobal, delta), x)); }

// One step of SGD on the log-loss for a (possibly soft) label y in [0,1].
//   user:   delta <- delta - lrU * (g + lambdaU * delta)
//   global: w     <- w     - lrG * (g + lambdaG * (w - prior))
const HYPER = { lrUser: 0.25, lrGlobal: 0.03, lambdaUser: 0.05, lambdaGlobal: 0.01 };
function sgdStep(wGlobal, delta, x, y, h = HYPER) {
  const p = predict(wGlobal, delta, x);
  const g = x.map((xi) => (p - y) * xi);
  const prior = priorWeights();
  const newDelta = delta.map((d, i) => d - h.lrUser * (g[i] + h.lambdaUser * d));
  const newGlobal = wGlobal.map((w, i) => w - h.lrGlobal * (g[i] + h.lambdaGlobal * (w - prior[i])));
  return { delta: newDelta, wGlobal: newGlobal, p, loss: -(y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9)) };
}

module.exports = { TYPES, FEATURES, DIM, priorWeights, featurize, predict, sgdStep, sigmoid, dot, HYPER };
