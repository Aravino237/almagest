// "Ask Almagest": a grounded, deterministic assistant.
//   1. Intent classification: TF-IDF nearest-centroid over the training phrases in intents.js.
//   2. Entity extraction: catalog objects matched by name / catalogue id / slug (longest match first).
//   3. Tool routing: every number in an answer comes from the same services the rest of the app uses
//      (ephemeris, recommender, event calculator, MongoDB logbook). Nothing is generated freely, so it cannot
//      invent a position, a date or a statistic. Low-confidence questions fall back to catalog retrieval.
const { Tfidf, cosine, centroid, tokens } = require("./text");
const INTENTS = require("./intents");
const sky = require("../astro/sky");
const { computeEvents } = require("../astro/events");
const M = require("../ml/model");
const { TYPE_LABEL } = require("../ml/recommender");

const names = Object.keys(INTENTS);
const phrases = names.flatMap((n) => INTENTS[n]);
const tfidf = new Tfidf(phrases);
const centroids = names.map((n) => ({ intent: n, c: centroid(INTENTS[n].map((p) => tfidf.vec(p))) }));

const THRESHOLD = 0.12;
function classify(text) {
  const v = tfidf.vec(text);
  const scores = centroids.map(({ intent, c }) => ({ intent, score: cosine(v, c) })).sort((a, b) => b.score - a.score);
  return { intent: scores[0].score >= THRESHOLD ? scores[0].intent : "unknown", confidence: +scores[0].score.toFixed(3), ranked: scores.slice(0, 3).map((s) => ({ intent: s.intent, score: +s.score.toFixed(3) })) };
}

const norm = (s) => " " + String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
function extractObject(text, objects) {
  const t = norm(text);
  const cands = [];
  for (const o of objects) for (const a of [o.name, o.catalog_id, o.slug]) { if (a && a.length > 1) cands.push({ o, a: norm(a) }); }
  cands.sort((x, y) => y.a.length - x.a.length);
  for (const { o, a } of cands) if (t.includes(a)) return o;
  return null;
}

const TYPE_INFO = {
  galaxy: "A galaxy is a gravitationally bound system of billions of stars, gas and dust. Even the brightest are faint, extended glows, so they reward dark skies.",
  nebula: "An emission or reflection nebula is a cloud of gas and dust, often a stellar nursery. Bright ones such as M42 show well even from suburbs.",
  globular_cluster: "A globular cluster is a dense, ancient ball of hundreds of thousands of stars. Small telescopes show a fuzzy glow; larger ones resolve the edge into stars.",
  open_cluster: "An open cluster is a loose group of young stars born together. Binoculars and low power suit them, and they cope well with light pollution.",
  planetary_nebula: "A planetary nebula is a shell of gas shed by a dying Sun-like star. Despite the name, it has nothing to do with planets.",
  double_star: "A double star is a pair of stars that appear close together; many are true binaries. Colour contrast is the attraction.",
  planet: "Planets are worlds in our own Solar System. Their position changes night to night, so Almagest computes them live.",
};
const TYPE_ALIASES = { galaxy: ["galaxy", "galaxies"], nebula: ["nebula", "nebulae", "nebulas"], globular_cluster: ["globular"], open_cluster: ["open cluster"], planetary_nebula: ["planetary nebula"], double_star: ["double star", "binary star"], planet: ["planet", "planets"] };
function extractType(text) {
  const t = norm(text);
  for (const [ty, al] of Object.entries(TYPE_ALIASES).sort((a, b) => b[1][0].length - a[1][0].length)) if (al.some((a) => t.includes(norm(a)))) return ty;
  return null;
}

const SINGULAR = { galaxy: "galaxy", nebula: "nebula", globular_cluster: "globular cluster", open_cluster: "open cluster", planetary_nebula: "planetary nebula", double_star: "double star", planet: "planet" };
const compass = (az) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8];
const fmtTime = (d, tz) => d ? new Date(d.getTime() + tz * 60e3).toISOString().slice(11, 16) : "n/a";
const where = (p) => p.location_name || "your location";

// Each handler returns { answer, data?, tools: [...] }
const handlers = {
  async plan({ ctx }) {
    const p = await ctx.svc.plan(ctx.user ? ctx.user.id : null, ctx.profile, ctx.now);
    const top = p.recommendations.slice(0, 3);
    if (!top.length) return { answer: `Nothing clears your limits right now at ${where(ctx.profile)} (limiting magnitude about ${p.limitMag}).`, tools: ["recommender"] };
    const lines = top.map((r, i) => `${i + 1}. ${r.name} (${SINGULAR[r.type]}, altitude ${Math.round(r.alt)}°, mag ${r.mag.toFixed(1)}). ${r.reasons.slice(0, 2).map((x) => x.text).join("; ")}.`);
    return { answer: `Top picks for ${where(ctx.profile)}${p.shifted ? " tonight" : ""}:\n${lines.join("\n")}\nMoon ${p.moon.illuminationPct}% lit. ${ctx.user ? "Ranked with your personal model." : "Sign in to personalise this."}`,
      data: { recommendations: top.map((r) => ({ name: r.name, alt: r.alt, mag: r.mag, score: r.score })) }, tools: ["recommender", "ephemeris"] };
  },
  async position({ ctx, object }) {
    if (!object) return { answer: "Which object? Try a name like \"Jupiter\", \"Orion Nebula\" or \"M31\".", tools: [] };
    const p = sky.position(object, ctx.now, ctx.profile.lat, ctx.profile.lon);
    const pts = sky.track(object, ctx.now, 24, 20, ctx.profile.lat, ctx.profile.lon);
    const night = pts.filter((q) => q.sunAlt < -12);
    const best = (night.length ? night : pts).reduce((a, b) => (b.alt > a.alt ? b : a));
    const now = p.alt > 0 ? `${object.name} is above the horizon: altitude ${p.alt.toFixed(1)}°, azimuth ${Math.round(p.az)}° (${compass(p.az)}).` : `${object.name} is below the horizon right now (altitude ${p.alt.toFixed(1)}°).`;
    const peak = best.alt > 0 ? ` In the next 24 hours its best dark-sky moment is ${fmtTime(new Date(best.t), ctx.tz)} local at ${best.alt.toFixed(0)}°.` : " It does not rise above your horizon in the next 24 hours.";
    const faint = p.mag !== undefined && p.mag > sky.limitingMagnitude(ctx.profile.bortle, ctx.profile.aperture_mm) ? " It is fainter than your estimated naked-eye limit, so you will need optical aid." : "";
    return { answer: now + peak + faint, data: { alt: +p.alt.toFixed(1), az: +p.az.toFixed(0), mag: p.mag === undefined ? null : +p.mag.toFixed(1) }, tools: ["ephemeris"] };
  },
  async moon({ ctx }) {
    const m = sky.moon(ctx.now, ctx.profile.lat, ctx.profile.lon), pct = Math.round(m.illumination * 100);
    const impact = m.alt < 0 ? "It is below the horizon, so it will not interfere right now." : pct > 70 ? "It is bright and up: faint galaxies and nebulae will be washed out; favour planets, double stars and bright clusters." : pct > 35 ? "Moderate moonlight: avoid the faintest targets near it." : "Little moonlight: good conditions for faint objects.";
    return { answer: `The Moon is ${m.phaseName.toLowerCase()}, ${pct}% illuminated, at altitude ${m.alt.toFixed(0)}° (${compass(m.az)}). ${impact}`, data: { illuminationPct: pct, phase: m.phaseName, alt: +m.alt.toFixed(1) }, tools: ["ephemeris"] };
  },
  async events({ ctx, text }) {
    const t = norm(text);
    const kind = t.includes("meteor") ? "meteor" : t.includes("eclipse") ? "eclipse" : t.includes("opposition") || t.includes("elongation") ? "planet" : t.includes("moon") ? "moon" : null;
    let ev = computeEvents(ctx.now, 120).filter((e) => new Date(e.date) >= ctx.now);
    if (kind) ev = ev.filter((e) => e.kind === kind);
    ev = ev.slice(0, 4);
    if (!ev.length) return { answer: "No matching events in the next 120 days.", tools: ["event-calculator"] };
    return { answer: "Coming up:\n" + ev.map((e) => `• ${e.date.slice(0, 10)}: ${e.title}. ${e.detail}.`).join("\n"), data: { events: ev }, tools: ["event-calculator"] };
  },
  async dark({ ctx }) {
    const w = sky.darkWindow(ctx.now, ctx.profile.lat, ctx.profile.lon);
    if (!w.dusk || !w.dawn) return { answer: "There is no astronomical night at this location right now.", tools: ["ephemeris"] };
    const hrs = ((w.dawn - w.dusk) / 3600e3).toFixed(1);
    return { answer: `Astronomical darkness (Sun more than 18° below the horizon) runs from ${fmtTime(w.dusk, ctx.tz)} to ${fmtTime(w.dawn, ctx.tz)} local, about ${hrs} hours, at ${where(ctx.profile)}.`, data: { dusk: w.dusk, dawn: w.dawn }, tools: ["ephemeris"] };
  },
  async about({ ctx, object, text }) {
    if (object) {
      const p = object.type === "planet" ? null : sky.position(object, ctx.now, ctx.profile.lat, ctx.profile.lon);
      const facts = object.type === "planet" ? "" : ` ${object.constellation}, magnitude ${object.magnitude}, about ${object.size_arcmin}′ across.`;
      return { answer: `${object.name}${object.catalog_id ? " (" + object.catalog_id + ")" : ""}: ${object.description}${facts} ${TYPE_INFO[object.type]}${p ? ` Right now it is at altitude ${p.alt.toFixed(0)}° from ${where(ctx.profile)}.` : ""}`, data: { object: object.slug }, tools: ["catalog", "ephemeris"] };
    }
    const ty = extractType(text);
    if (ty) return { answer: TYPE_INFO[ty], tools: ["catalog"] };
    if (norm(text).includes("ptolemy") || norm(text).includes("almagest")) return { answer: "The Almagest is Claudius Ptolemy's 2nd-century treatise on the motions of the stars and planets. It catalogued 1,022 stars and shaped astronomy for about 1,400 years. This portal borrows its name.", tools: ["catalog"] };
    return null; // fall through to retrieval
  },
  async stats({ ctx }) {
    if (!ctx.user) return { answer: "Sign in and I can summarise your logbook.", tools: [] };
    const obs = await ctx.mongo.col("observations");
    const rows = await obs.aggregate([{ $match: { userId: ctx.user.id } }, { $group: { _id: "$objectId", n: { $sum: 1 } } }]).toArray();
    const total = rows.reduce((a, r) => a + r.n, 0);
    if (!total) return { answer: "Your logbook is empty. Log an observation and I will start learning your tastes.", tools: ["mongodb"] };
    const top = rows.filter((r) => r._id).sort((a, b) => b.n - a.n).slice(0, 3);
    const nm = top.length ? new Map((await ctx.db.query("SELECT id, name FROM objects WHERE id = ANY($1)", [top.map((r) => r._id)])).rows.map((o) => [o.id, o.name])) : new Map();
    return { answer: `You have ${total} logged observation${total === 1 ? "" : "s"} across ${rows.length} target${rows.length === 1 ? "" : "s"}.${top.length ? " Most logged: " + top.map((r) => `${nm.get(r._id) || "Unknown"} (${r.n})`).join(", ") + "." : ""}`, data: { total, distinct: rows.length }, tools: ["mongodb", "postgres"] };
  },
  async affinity({ ctx }) {
    if (!ctx.user) return { answer: "Sign in and rate a few sessions; then I can show what the model has learned about you.", tools: [] };
    const m = await ctx.svc.loadModel(ctx.user.id);
    if (!m.userUpdates) return { answer: "No personal data yet: your recommendations use the population model. Rate some objects with thumbs or log observations.", tools: ["model"] };
    const aff = M.TYPES.map((t) => ({ t, d: m.delta[M.FEATURES.indexOf("type:" + t)] })).sort((a, b) => b.d - a.d);
    const likes = aff.filter((a) => a.d > 0.1).slice(0, 2), dis = aff.filter((a) => a.d < -0.1).slice(-2);
    const s = (xs) => xs.map((a) => `${TYPE_LABEL[a.t]} (${a.d > 0 ? "+" : ""}${a.d.toFixed(2)})`).join(", ");
    return { answer: `From ${m.userUpdates} rated example${m.userUpdates === 1 ? "" : "s"}: ${likes.length ? "you lean towards " + s(likes) : "no strong favourite type yet"}${dis.length ? "; you rate " + s(dis) + " lower" : ""}. Values are your personal offset to the shared model's weights.`, data: { affinities: aff.map((a) => ({ type: a.t, delta: +a.d.toFixed(3) })) }, tools: ["model"] };
  },
  async help() {
    return { answer: "I can plan tonight's session, tell you where an object is, report the Moon's impact, list upcoming events, give your dark window, explain catalog objects, summarise your logbook and show what Almagest has learned about your tastes. Every number comes from the same ephemeris and model the rest of the site uses.", tools: [] };
  },
};

// Retrieval fallback: best catalog object by TF-IDF over name, constellation, type and description.
function retrieve(text, objects) {
  const docs = objects.map((o) => `${o.name} ${o.catalog_id || ""} ${o.constellation || ""} ${o.type.replace("_", " ")} ${o.description}`);
  const idx = new Tfidf(docs), q = idx.vec(text);
  let best = null, bs = 0;
  docs.forEach((d, i) => { const s = cosine(q, idx.vec(d)); if (s > bs) { bs = s; best = objects[i]; } });
  return bs > 0.15 ? { object: best, score: +bs.toFixed(3) } : null;
}

async function answer(text, ctx) {
  const cls = classify(text);
  const object = extractObject(text, ctx.objects);
  let intent = cls.intent;
  // An object mention with a weak or unrelated intent is most naturally a "where is it" or "about it" question.
  if (object && (intent === "unknown" || intent === "help")) intent = "about";
  let out = intent === "unknown" ? null : await handlers[intent]({ ctx, object, text });
  let via = "intent";
  if (!out) {
    const r = retrieve(text, ctx.objects);
    if (r) { intent = "about"; via = "retrieval"; out = await handlers.about({ ctx, object: r.object, text }); }
  }
  if (!out) return { intent: "unknown", confidence: cls.confidence, answer: "I couldn't map that to something I can answer reliably. Try asking about tonight's plan, an object by name, the Moon, upcoming events or your dark window.", tools: [], object: null, via: "none" };
  return { intent, confidence: cls.confidence, object: object ? object.slug : null, via, ...out };
}

module.exports = { classify, extractObject, answer, retrieve, INTENT_NAMES: names };
