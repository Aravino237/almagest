const express = require("express");
const { z } = require("zod");
const db = require("../db");
const mongo = require("../mongo");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const svc = require("../services/recommender-service");
const sky = require("../astro/sky");
const M = require("../ml/model");
const { TYPE_LABEL } = require("../ml/recommender");

const router = express.Router();

const GUEST = { lat: 12.82, lon: 80.04, location_name: "Kattankulathur, India", bortle: 6, aperture_mm: 0, experience: "beginner", min_alt: 15 };

const planBody = z.object({
  at: z.coerce.date().optional(),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
});

// POST /api/plan: personalised for signed-in users, population model for guests.
router.post("/plan", optionalAuth, validate(planBody), async (req, res) => {
  const base = req.user ? await svc.getProfile(req.user.id) : GUEST;
  const profile = { ...base };
  if (req.body.lat !== undefined && req.body.lon !== undefined) { profile.lat = req.body.lat; profile.lon = req.body.lon; profile.location_name = "Custom location"; }
  const plan = await svc.plan(req.user ? req.user.id : null, profile, req.body.at || new Date());
  res.json(plan);
});

router.get("/tonight", optionalAuth, async (req, res) => {
  const p = req.user ? await svc.getProfile(req.user.id) : GUEST;
  const now = new Date();
  const w = sky.darkWindow(now, p.lat, p.lon), m = sky.moon(now, p.lat, p.lon);
  res.json({ location: p.location_name, sunAlt: +w.sunAlt.toFixed(1), dusk: w.dusk, dawn: w.dawn,
    moon: { illuminationPct: Math.round(m.illumination * 100), phaseName: m.phaseName, alt: +m.alt.toFixed(1) } });
});

const fb = z.object({
  objectId: z.number().int().positive(), liked: z.boolean(), at: z.coerce.date(),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
});
// Thumbs up/down on a recommendation. Features are recomputed server-side from the
// session time and location, never trusted from the client.
router.post("/feedback", requireAuth, validate(fb), async (req, res) => {
  const p = await svc.getProfile(req.user.id);
  const lat = req.body.lat ?? p.lat, lon = req.body.lon ?? p.lon;
  const r = await svc.learn(req.user.id, req.body.objectId, req.body.liked ? 1 : 0, "thumbs", req.body.at, lat, lon, null, true);
  if (!r) throw new HttpError(404, "Unknown object");
  res.status(201).json(r);
});

// What the model has learned about this user, in plain terms.
router.get("/model/me", requireAuth, async (req, res) => {
  const m = await svc.loadModel(req.user.id);
  const prior = M.priorWeights();
  const features = M.FEATURES.map((f, i) => ({ feature: f, prior: prior[i], global: +m.wGlobal[i].toFixed(3),
    personal: +m.delta[i].toFixed(3), effective: +(m.wGlobal[i] + m.delta[i]).toFixed(3) }));
  const affinities = M.TYPES.map((t) => { const i = M.FEATURES.indexOf("type:" + t);
    return { type: t, label: TYPE_LABEL[t], personal: +m.delta[i].toFixed(3), global: +m.wGlobal[i].toFixed(3) }; });
  const fb = await (await mongo.col("feedback")).find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(15).toArray();
  const names = fb.length ? (await db.query("SELECT id, name, type FROM objects WHERE id = ANY($1)", [fb.map((f) => f.objectId)])).rows : [];
  const byId = new Map(names.map((o) => [o.id, o]));
  const recent = fb.map((f) => ({ label: f.label, source: f.source, created_at: f.createdAt, name: (byId.get(f.objectId) || {}).name || "Unknown", type: f.objectType }));
  res.json({ examples: m.userUpdates, globalUpdates: m.globalUpdates, features, affinities, recent });
});

router.delete("/model/me", requireAuth, async (req, res) => {
  await db.tx(async (c) => {
    await (await mongo.col("feedback")).deleteMany({ userId: req.user.id });
    await c.query("DELETE FROM user_models WHERE user_id=$1", [req.user.id]);
  });
  res.status(204).end();
});

router.get("/health", async (req, res) => {
  const check = (fn) => fn().then(() => "up", () => "down");
  const [pg, mg] = await Promise.all([check(() => db.query("SELECT 1")), check(() => mongo.ping())]);
  res.status(pg === "up" && mg === "up" ? 200 : 503).json({ status: pg === "up" && mg === "up" ? "ok" : "degraded", db: pg, mongo: mg });
});

module.exports = router;
