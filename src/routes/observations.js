// Observation logbook, stored as documents in MongoDB. Each document is self-contained
// (nested location and conditions, denormalised object name and type), which is what
// makes the aggregation queries below cheap and lets the schema grow without migrations.
const express = require("express");
const { z } = require("zod");
const db = require("../db");
const mongo = require("../mongo");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const { requireAuth } = require("../middleware/auth");
const svc = require("../services/recommender-service");

const router = express.Router();
router.use(requireAuth);

const body = z.object({
  objectId: z.number().int().positive().nullable().optional(),
  targetName: z.string().trim().min(1).max(120).optional(),
  observedAt: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 864e5, "Observation time can't be in the future"),
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  seeing: z.number().int().min(1).max(5), transparency: z.number().int().min(1).max(5),
  rating: z.number().int().min(1).max(5),
  equipment: z.string().trim().max(120).default(""), notes: z.string().trim().max(2000).default(""),
}).refine((b) => b.objectId || b.targetName, { message: "Pick a catalog object or type a target name", path: ["targetName"] });

// Mongo document -> the flat JSON the frontend uses
const shape = (d) => ({ id: d._id.toString(), objectId: d.objectId, targetName: d.targetName, objectType: d.objectType === "other" ? null : d.objectType,
  observedAt: d.observedAt, lat: d.location.lat, lon: d.location.lon, seeing: d.conditions.seeing, transparency: d.conditions.transparency,
  rating: d.rating, equipment: d.equipment, notes: d.notes, createdAt: d.createdAt });

async function toDoc(userId, b) {
  let targetName = b.targetName, objectType = "other";   // always present, so it can be grouped on directly
  if (b.objectId) {
    const o = (await db.query("SELECT name, type FROM objects WHERE id=$1", [b.objectId])).rows[0];
    if (!o) throw new HttpError(400, "Unknown catalog object");
    targetName = o.name; objectType = o.type;
  }
  return { userId, objectId: b.objectId || null, objectType, targetName, observedAt: b.observedAt,
    location: { lat: b.lat, lon: b.lon }, conditions: { seeing: b.seeing, transparency: b.transparency },
    rating: b.rating, equipment: b.equipment, notes: b.notes };
}

function parseId(str) {
  const id = mongo.toObjectId(str);
  if (!id) throw new HttpError(400, "Invalid identifier");
  return id;
}

router.get("/", async (req, res) => {
  const docs = await (await mongo.col("observations")).find({ userId: req.user.id }).sort({ observedAt: -1 }).limit(500).toArray();
  res.json({ observations: docs.map(shape) });
});

// Group by `field` and rating in the database ($group with a count), then derive per-group
// counts and rating totals. Ratings only take 5 values, so this stays tiny, and it relies only
// on the most basic accumulator ($sum: 1), which every MongoDB-compatible server implements.
async function groupBy(obs, userId, field) {
  const rows = await obs.aggregate([{ $match: { userId } },
    { $group: { _id: { k: field, r: "$rating" }, n: { $sum: 1 } } }]).toArray();
  const map = new Map();
  for (const row of rows) {
    const g = map.get(row._id.k) || { _id: row._id.k, n: 0, ratingSum: 0 };
    g.n += row.n; g.ratingSum += row._id.r * row.n; map.set(row._id.k, g);
  }
  return [...map.values()].sort((a, b) => b.n - a.n);
}

router.get("/stats", async (req, res) => {
  const obs = await mongo.col("observations"), userId = req.user.id;
  const [total, objs, last, byType] = await Promise.all([
    obs.countDocuments({ userId }), obs.distinct("objectId", { userId, objectId: { $ne: null } }),
    obs.find({ userId }).sort({ observedAt: -1 }).limit(1).toArray(), groupBy(obs, userId, "$objectType")]);
  const rated = byType.reduce((s, r) => s + r.ratingSum, 0);
  res.json({ total, distinct_objects: objs.length, avg_rating: total ? +(rated / total).toFixed(2) : null,
    last_session: last[0] ? last[0].observedAt : null,
    byType: byType.map((r) => ({ type: r._id, n: r.n, avg_rating: +(r.ratingSum / r.n).toFixed(2) })) });
});

// Aggregation-pipeline insights: which conditions and targets give you your best nights.
router.get("/insights", async (req, res) => {
  const obs = await mongo.col("observations"), userId = req.user.id;
  const [bySeeing, byTransparency, byType, byTarget] = await Promise.all([
    groupBy(obs, userId, "$conditions.seeing"), groupBy(obs, userId, "$conditions.transparency"),
    groupBy(obs, userId, "$objectType"), groupBy(obs, userId, "$targetName")]);
  const top = byTarget.slice(0, 5);
  const fmt = (rows, name) => rows.map((r) => ({ [name]: r._id, n: r.n, avgRating: +(r.ratingSum / r.n).toFixed(2) }));
  res.json({
    bySeeing: fmt(bySeeing, "seeing").sort((a, b) => a.seeing - b.seeing),
    byTransparency: fmt(byTransparency, "transparency").sort((a, b) => a.transparency - b.transparency),
    byType: fmt(byType, "type"), topTargets: fmt(top, "target"),
  });
});

router.post("/", validate(body), async (req, res) => {
  const b = req.body;
  const doc = { ...(await toDoc(req.user.id, b)), createdAt: new Date() };
  const ins = await (await mongo.col("observations")).insertOne(doc);
  doc._id = ins.insertedId;
  // A rated observation of a catalog object is a training example: rating 1..5 -> soft label 0..1.
  let learned = null;
  if (doc.objectId) learned = await svc.learn(req.user.id, doc.objectId, (doc.rating - 1) / 4, "log", doc.observedAt, b.lat, b.lon, doc._id);
  // Plausibility check: a catalog object below the horizon at the logged time usually means a time-zone or location mistake.
  const warning = learned && learned.alt < 0
    ? `${doc.targetName} was ${Math.abs(learned.alt).toFixed(0)}° below the horizon at that time and place. Check the time zone and location.` : null;
  res.status(201).json({ observation: shape(doc), learned, warning });
});

router.put("/:id", validate(body), async (req, res) => {
  const id = parseId(req.params.id), b = req.body;
  const set = await toDoc(req.user.id, b);
  const obs = await mongo.col("observations");
  const doc = await obs.findOneAndUpdate({ _id: id, userId: req.user.id }, { $set: set }, { returnDocument: "after" });
  if (!doc) throw new HttpError(404, "Observation not found");
  // Replace the training example derived from this log, then refit the personal model.
  await (await mongo.col("feedback")).deleteMany({ observationId: id });
  if (doc.objectId) await svc.learn(req.user.id, doc.objectId, (doc.rating - 1) / 4, "log", doc.observedAt, b.lat, b.lon, id);
  else await db.tx((c) => svc.retrainUser(c, req.user.id));
  res.json({ observation: shape(doc) });
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const r = await (await mongo.col("observations")).deleteOne({ _id: id, userId: req.user.id });
  if (!r.deletedCount) throw new HttpError(404, "Observation not found");
  await (await mongo.col("feedback")).deleteMany({ observationId: id });   // no foreign-key cascade across databases
  await db.tx((c) => svc.retrainUser(c, req.user.id));
  res.status(204).end();
});

module.exports = router;
