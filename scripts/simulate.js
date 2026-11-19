// Offline evaluation of the recommender with simulated users.
//
// There is no public dataset of "amateur astronomer X enjoyed object Y on night Z", so
// we evaluate the learning loop against simulated users whose true preferences are
// known. Each user has hidden weights w* = prior + population shift + personal taste.
// The population shift (everyone likes planets a bit more and double stars a bit less
// than the prior assumes) is something only cross-user learning can discover; the
// personal taste is something only per-user learning can discover.
// Every session, a method recommends 5 targets out of the physically feasible ones,
// the user gives thumbs up/down (Bernoulli of their true enjoyment probability), and
// the method learns from it. We measure how close each method gets to an oracle.
//
// This tests whether the learning mechanism works. It is NOT evidence about real
// users' preferences: that needs a user study.
const fs = require("fs");
const path = require("path");
const { DSO, PLANETS } = require("../db/catalog");
const M = require("../src/ml/model");
const R = require("../src/ml/recommender");
const sky = require("../src/astro/sky");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const USERS = Number(args.users || 150), SESSIONS = Number(args.sessions || 15), SEED = Number(args.seed || 7);

let s = SEED >>> 0;
const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const pick = (a) => a[Math.floor(rand() * a.length)];

const objects = [
  ...DSO.map(([slug, name, catalog_id, type, ra_hours, dec_deg, magnitude, size_arcmin], i) => ({ id: i + 1, slug, name, catalog_id, type, ra_hours, dec_deg, magnitude, size_arcmin })),
  ...PLANETS.map(([slug, name, size_arcmin], i) => ({ id: DSO.length + i + 1, slug, name, type: "planet", size_arcmin })),
];
const prior = M.priorWeights();
const fi = (f) => M.FEATURES.indexOf(f);
const POP_SHIFT = { "type:planet": 0.8, "type:double_star": -0.6, "type:globular_cluster": 0.3 };

// ---- simulated users and their sessions (contexts are shared by all methods) ----
const users = [];
for (let u = 0; u < USERS; u++) {
  const wTrue = prior.slice();
  for (const [f, v] of Object.entries(POP_SHIFT)) wTrue[fi(f)] += v;
  for (const t of M.TYPES) wTrue[fi("type:" + t)] += 1.1 * gauss();
  wTrue[fi("moon_glare")] *= Math.exp(0.4 * gauss());
  wTrue[fi("altitude")] *= Math.exp(0.3 * gauss());
  const profile = { lat: -35 + rand() * 90, lon: -120 + rand() * 240, bortle: 2 + Math.floor(rand() * 7),
    aperture_mm: pick([0, 50, 80, 130, 200, 300]), experience: pick(["beginner", "intermediate", "advanced"]), min_alt: 15 };
  const sessions = [];
  for (let t = 0; t < SESSIONS; t++) {
    const day = Date.UTC(2026, 0, 1) + Math.floor(rand() * 365) * 864e5;
    const local21 = new Date(day + (21 - profile.lon / 15) * 3600e3 + rand() * 3 * 3600e3);
    const at = R.sessionMoment(local21, profile.lat, profile.lon).at;
    const moon = sky.moon(at, profile.lat, profile.lon);
    const limit = sky.limitingMagnitude(profile.bortle, profile.aperture_mm);
    const cands = [];
    for (const obj of objects) {
      const c = R.contextFor(obj, at, profile, moon, false);
      if (c.pos.alt >= profile.min_alt && c.pos.mag <= limit) cands.push({ obj, x: c.x });
    }
    sessions.push(cands);
  }
  users.push({ wTrue, sessions });
}

// ---- methods ----
const zeros = () => new Array(M.DIM).fill(0);
const METHODS = {
  "Random feasible": { learnGlobal: false, learnUser: false, random: true },
  "Rule prior (no learning)": { learnGlobal: false, learnUser: false },
  "Global model only": { learnGlobal: true, learnUser: false },
  "Per-user model only": { learnGlobal: false, learnUser: true },
  "Hierarchical (Almagest)": { learnGlobal: true, learnUser: true },
};

const results = {};
for (const [name, cfg] of Object.entries(METHODS)) {
  let wGlobal = prior.slice();
  const state = users.map(() => ({ delta: zeros(), examples: [], seen: new Set(), typeCounts: {} }));
  const perSession = Array.from({ length: SESSIONS }, () => ({ sat: 0, ratio: 0, prec: 0, likes: 0, n: 0 }));
  for (let t = 0; t < SESSIONS; t++) {
    for (let u = 0; u < USERS; u++) {
      const st = state[u], user = users[u];
      const cands = user.sessions[t].map((c) => {
        const x = c.x.slice(); x[fi("novelty")] = st.seen.has(c.obj.id) ? 0 : 1;
        return { obj: c.obj, x, p: M.predict(wGlobal, st.delta, x), truth: M.sigmoid(M.dot(user.wTrue, x)) };
      });
      if (cands.length < 5) continue;
      let picks;
      if (cfg.random) { picks = [...cands].sort(() => rand() - 0.5).slice(0, 5); }
      else picks = R.rank(cands, st.typeCounts, 5);
      const oracle = [...cands].sort((a, b) => b.truth - a.truth).slice(0, 5);
      const oracleIds = new Set(oracle.map((c) => c.obj.id));
      const sat = picks.reduce((a, c) => a + c.truth, 0) / 5, best = oracle.reduce((a, c) => a + c.truth, 0) / 5;
      const ps = perSession[t];
      ps.sat += sat; ps.ratio += sat / best; ps.prec += picks.filter((c) => oracleIds.has(c.obj.id)).length / 5; ps.n++;
      // user feedback and learning
      for (const c of picks) {
        const y = rand() < c.truth ? 1 : 0;
        ps.likes += y / 5;
        st.seen.add(c.obj.id); st.typeCounts[c.obj.type] = (st.typeCounts[c.obj.type] || 0) + 1;
        if (cfg.learnGlobal) wGlobal = M.sgdStep(wGlobal, st.delta, c.x, y).wGlobal;
        st.examples.push({ x: c.x, y });
      }
      if (cfg.learnUser) {           // same refit-by-replay the server does
        let d = zeros();
        for (let e = 0; e < 3; e++) for (const ex of st.examples) d = M.sgdStep(wGlobal, d, ex.x, ex.y).delta;
        st.delta = d;
      }
    }
  }
  results[name] = perSession.map((p) => ({ satisfaction: p.sat / p.n, oracleRatio: p.ratio / p.n, precisionAt5: p.prec / p.n, likeRate: p.likes / p.n }));
}

// ---- report ----
const avg = (rows, a, b, k) => rows.slice(a, b).reduce((s, r) => s + r[k], 0) / (b - a);
const warmFrom = Math.max(1, SESSIONS - 5);
console.log(`\nSimulated users: ${USERS}, sessions each: ${SESSIONS}, seed ${SEED}\n`);
console.log("Method".padEnd(28) + "P@5 first3  P@5 last5  Like-rate last5  Satisfaction/oracle last5");
for (const [name, rows] of Object.entries(results))
  console.log(name.padEnd(28) + avg(rows, 0, 3, "precisionAt5").toFixed(3).padStart(10) + avg(rows, warmFrom, SESSIONS, "precisionAt5").toFixed(3).padStart(11)
    + avg(rows, warmFrom, SESSIONS, "likeRate").toFixed(3).padStart(17) + avg(rows, warmFrom, SESSIONS, "oracleRatio").toFixed(3).padStart(27));
const out = path.join(__dirname, "..", "simulation-results.json");
fs.writeFileSync(out, JSON.stringify({ users: USERS, sessions: SESSIONS, seed: SEED, results }, null, 1));
console.log(`\nPer-session curves written to ${path.relative(process.cwd(), out)}`);
