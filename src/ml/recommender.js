// Recommender: hard feasibility rules first (physics), then a learned ranking.
// Pure functions only. Database access lives in src/services/recommender-service.js.
const sky = require("../astro/sky");
const M = require("./model");

const TYPE_LABEL = { galaxy: "galaxies", nebula: "nebulae", globular_cluster: "globular clusters",
  open_cluster: "open clusters", planetary_nebula: "planetary nebulae", double_star: "double stars", planet: "planets" };

// Choose the moment to plan for: the requested time if it is dark enough, else tonight's astronomical dusk + 30 min.
function sessionMoment(date, lat, lon) {
  const sunAlt = sky.sunAltitude(date, lat, lon);
  if (sunAlt <= -12) return { at: date, shifted: false, sunAlt };
  const w = sky.darkWindow(date, lat, lon);
  if (!w.dusk) return { at: date, shifted: false, sunAlt, note: "The Sun never gets 18° below the horizon here on this date, so only bright targets will show." };
  const at = new Date(w.dusk.getTime() + 30 * 60e3);
  return { at, shifted: true, sunAlt: sky.sunAltitude(at, lat, lon),
    note: `The Sun is up at the requested time (${sunAlt.toFixed(0)}°), so this plan is for tonight's astronomical darkness.` };
}

function contextFor(obj, at, profile, moon, seen) {
  const pos = sky.position(obj, at, profile.lat, profile.lon);
  const limitMag = sky.limitingMagnitude(profile.bortle, profile.aperture_mm);
  const ctx = {
    alt: pos.alt, mag: pos.mag, limitMag, moonIllum: moon.illumination, moonAlt: moon.alt,
    moonSepDeg: sky.separation(pos.ra, pos.dec, moon.ra, moon.dec), bortle: profile.bortle,
    experience: profile.experience, seen,
  };
  return { pos, ctx, x: M.featurize(obj, ctx) };
}

function explain(obj, ctx, x, wGlobal, delta) {
  const w = wGlobal.map((g, i) => g + delta[i]);
  const idx = (name) => M.FEATURES.indexOf(name);
  const c = (name) => w[idx(name)] * x[idx(name)];
  const personal = (name) => delta[idx(name)] * x[idx(name)];
  const items = [];
  // Each reason has a natural direction. It is shown only when the learned weight agrees
  // with it; when the user's own ratings have flipped a factor, we say that instead.
  const add = (name, natural, text, flippedText) => {
    const v = c(name);
    if (Math.sign(v) === natural && Math.abs(v) > 0.05) items.push({ v, text });
    else if (flippedText && Math.abs(personal(name)) > 0.2) items.push({ v: personal(name), text: flippedText, personal: true });
  };
  const alt = Math.round(ctx.alt), mag = ctx.mag.toFixed(1), lim = ctx.limitMag.toFixed(1);
  if (ctx.alt >= 45) add("altitude", 1, `High in the sky at ${alt}°, above most of the haze`);
  else if (ctx.alt >= 30) add("altitude", 1, `Well placed at ${alt}° altitude`);
  else items.push({ v: -0.6, text: `Low at ${alt}°, so you are looking through thicker atmosphere` });
  const margin = ctx.limitMag - ctx.mag;
  if (margin >= 2) add("reach_margin", 1, `Comfortably within reach (mag ${mag}; your limit is about ${lim})`, "Your ratings suggest the easiest, brightest targets excite you less");
  else items.push({ v: -0.5, text: `Close to the limit of your setup (mag ${mag} vs about ${lim})` });
  if (x[idx("moon_glare")] > 0.08) add("moon_glare", -1, `${Math.round(ctx.moonIllum * 100)}% Moon ${Math.round(ctx.moonSepDeg)}° away will wash out faint detail`);
  if (c("surface_dimness") < -0.25) add("surface_dimness", -1, `Its light is spread thin, which suffers under Bortle ${ctx.bortle} skies`);
  if (c("beginner_faint") < -0.25) add("beginner_faint", -1, "Faint for a first attempt, so use averted vision");
  if (x[idx("novelty")] === 1) add("novelty", 1, "You haven't logged or rated it yet", "So far you've rated familiar targets higher than new ones");
  const ti = idx("type:" + obj.type);
  if (delta[ti] > 0.15) items.push({ v: delta[ti] * 2, personal: true, text: `Your ratings show you enjoy ${TYPE_LABEL[obj.type]}` });
  if (delta[ti] < -0.15) items.push({ v: delta[ti] * 2, personal: true, text: `You've rated ${TYPE_LABEL[obj.type]} lower in the past` });
  return items.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 4)
    .map((i) => ({ text: i.text, effect: i.v >= 0 ? "+" : "-", personal: !!i.personal }));
}

// Rank scored candidates: top k-1 by predicted enjoyment, plus one exploration slot.
// Exploration picks the remaining target with the best optimistic score, where the
// optimism bonus shrinks as the user rates more objects of that type (UCB-style).
function rank(cands, typeCounts, k = 5, bonus = 0.35) {
  const sorted = [...cands].sort((a, b) => b.p - a.p);
  const picks = sorted.slice(0, Math.max(0, k - 1)).map((c) => ({ ...c, explore: false }));
  const rest = sorted.slice(k - 1);
  if (rest.length) {
    const ucb = (c) => c.p + bonus / Math.sqrt(1 + (typeCounts[c.obj.type] || 0));
    picks.push({ ...rest.reduce((b, c) => (ucb(c) > ucb(b) ? c : b)), explore: true });
  }
  return picks;
}

// objects: rows from `objects`; seen: Set of object ids; typeCounts: {type: n ratings}
function buildPlan({ date, profile, objects, seen, typeCounts, wGlobal, delta, k = 5 }) {
  const moment = sessionMoment(date, profile.lat, profile.lon);
  const at = moment.at;
  const moon = sky.moon(at, profile.lat, profile.lon);
  const limitMag = sky.limitingMagnitude(profile.bortle, profile.aperture_mm);
  const rejected = { belowMinAltitude: 0, tooFaint: 0 };
  const cands = [];
  for (const obj of objects) {
    const { pos, ctx, x } = contextFor(obj, at, profile, moon, seen.has(obj.id));
    if (pos.alt < profile.min_alt) { rejected.belowMinAltitude++; continue; }
    if (pos.mag > limitMag) { rejected.tooFaint++; continue; }
    cands.push({ obj, pos, ctx, x, p: M.predict(wGlobal, delta, x) });
  }
  const picks = rank(cands, typeCounts, k);
  return {
    at: at.toISOString(), shifted: moment.shifted, note: moment.note || null,
    sunAlt: +moment.sunAlt.toFixed(1),
    location: { lat: profile.lat, lon: profile.lon, name: profile.location_name },
    limitMag: +limitMag.toFixed(1),
    moon: { illuminationPct: Math.round(moon.illumination * 100), phaseName: moon.phaseName, alt: +moon.alt.toFixed(1) },
    considered: objects.length, feasible: cands.length, rejected,
    recommendations: picks.map((c) => ({
      objectId: c.obj.id, slug: c.obj.slug, name: c.obj.name, catalogId: c.obj.catalog_id, type: c.obj.type,
      constellation: c.obj.constellation, alt: +c.pos.alt.toFixed(1), az: +c.pos.az.toFixed(1),
      mag: +c.pos.mag.toFixed(1), score: +c.p.toFixed(3), explore: c.explore,
      reasons: explain(c.obj, c.ctx, c.x, wGlobal, delta),
    })),
  };
}

module.exports = { buildPlan, rank, contextFor, sessionMoment, explain, TYPE_LABEL };
