const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/ml/model");
const R = require("../src/ml/recommender");
const { DSO, PLANETS } = require("../db/catalog");

const objects = [...DSO.map(([slug, name, catalog_id, type, ra_hours, dec_deg, magnitude, size_arcmin], i) => ({ id: i + 1, slug, name, catalog_id, type, ra_hours, dec_deg, magnitude, size_arcmin })),
  ...PLANETS.map(([slug, name, size_arcmin], i) => ({ id: 100 + i, slug, name, type: "planet", size_arcmin }))];
const profile = { lat: 12.82, lon: 80.04, location_name: "x", bortle: 6, aperture_mm: 200, experience: "beginner", min_alt: 15 };
const zeros = () => new Array(M.DIM).fill(0);
const plan = (delta, extra = {}) => R.buildPlan({ date: new Date("2026-10-15T15:30:00Z"), profile, objects, seen: new Set(), typeCounts: {}, wGlobal: M.priorWeights(), delta, ...extra });

test("feature vector has one slot per declared feature and a one-hot type", () => {
  const x = M.featurize(objects[0], { alt: 40, mag: 8, limitMag: 12, moonIllum: 0.5, moonAlt: 10, moonSepDeg: 30, bortle: 5, experience: "beginner", seen: false });
  assert.equal(x.length, M.FEATURES.length);
  assert.equal(M.TYPES.reduce((s, t) => s + x[M.FEATURES.indexOf("type:" + t)], 0), 1);
});

test("an SGD step lowers the loss on that example", () => {
  const x = M.featurize(objects[0], { alt: 40, mag: 8, limitMag: 12, moonIllum: 0.5, moonAlt: 10, moonSepDeg: 30, bortle: 5, experience: "beginner", seen: false });
  const s1 = M.sgdStep(M.priorWeights(), zeros(), x, 0);
  const s2 = M.sgdStep(s1.wGlobal, s1.delta, x, 0);
  assert.ok(s2.loss < s1.loss);
});

test("hard constraints: every recommendation is above min altitude and within reach", () => {
  const p = plan(zeros());
  assert.equal(p.recommendations.length, 5);
  for (const r of p.recommendations) { assert.ok(r.alt >= profile.min_alt); assert.ok(r.mag <= p.limitMag); }
  assert.equal(p.recommendations.filter((r) => r.explore).length, 1);
  assert.equal(p.feasible + p.rejected.belowMinAltitude + p.rejected.tooFaint, p.considered);
});

test("learned preference for galaxies moves galaxies up the ranking", () => {
  const galaxiesIn = (p) => p.recommendations.filter((r) => !r.explore && r.type === "galaxy").length;
  const d = zeros(); d[M.FEATURES.indexOf("type:galaxy")] = 2.5;
  assert.ok(galaxiesIn(plan(d)) > galaxiesIn(plan(zeros())));
  assert.ok(plan(d).recommendations[0].reasons.some((r) => r.personal && /galaxies/.test(r.text)));
});

test("daytime requests are shifted to astronomical darkness", () => {
  const p = R.buildPlan({ date: new Date("2026-10-15T06:00:00Z"), profile, objects, seen: new Set(), typeCounts: {}, wGlobal: M.priorWeights(), delta: zeros() });
  assert.equal(p.shifted, true);
  assert.ok(p.sunAlt <= -17.9);
});
