const express = require("express");
const { z } = require("zod");
const db = require("../db");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { computeEvents } = require("../astro/events");

const router = express.Router();

// Computed events depend only on the day, so cache them per UTC day.
const cache = new Map();
router.get("/sky", validate(z.object({ days: z.coerce.number().int().min(1).max(366).default(90) }), "query"), (req, res) => {
  const { days } = req.validQuery;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const key = today.toISOString() + days;
  if (!cache.has(key)) { cache.clear(); cache.set(key, computeEvents(today, days)); }
  res.json({ from: today.toISOString(), days, events: cache.get(key) });
});

const shape = (r, uid) => ({ id: r.id, title: r.title, description: r.description, startsAt: r.starts_at, locationName: r.location_name,
  host: r.host, rsvps: r.rsvps, going: !!r.going, mine: uid === r.user_id });

router.get("/community", optionalAuth, async (req, res) => {
  const uid = req.user ? req.user.id : null;
  const rows = (await db.query(
    `SELECT e.*, u.display_name AS host, (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id=e.id) AS rsvps,
            EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1) AS going
     FROM community_events e JOIN users u ON u.id=e.user_id
     WHERE e.starts_at > now() - interval '1 day' ORDER BY e.starts_at LIMIT 200`, [uid])).rows;
  res.json({ events: rows.map((r) => shape(r, uid)) });
});

const body = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().max(2000).default(""),
  startsAt: z.coerce.date().refine((d) => d.getTime() > Date.now() - 36e5, "Event must be in the future"),
  locationName: z.string().trim().min(1).max(120),
});
router.post("/community", requireAuth, validate(body), async (req, res) => {
  const b = req.body;
  const r = (await db.query(`INSERT INTO community_events(user_id,title,description,starts_at,location_name) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, b.title, b.description, b.startsAt, b.locationName])).rows[0];
  await db.query("INSERT INTO event_rsvps(event_id,user_id) VALUES ($1,$2)", [r.id, req.user.id]);
  res.status(201).json({ event: shape({ ...r, host: req.user.name, rsvps: 1, going: true }, req.user.id) });
});

router.delete("/community/:id", requireAuth, async (req, res) => {
  const r = await db.query("DELETE FROM community_events WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  if (!r.rowCount) throw new HttpError(404, "Event not found, or you are not its host");
  res.status(204).end();
});

router.post("/community/:id/rsvp", requireAuth, async (req, res) => {
  const e = await db.query("SELECT 1 FROM community_events WHERE id=$1", [req.params.id]);
  if (!e.rowCount) throw new HttpError(404, "Event not found");
  const del = await db.query("DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  if (!del.rowCount) await db.query("INSERT INTO event_rsvps(event_id,user_id) VALUES ($1,$2)", [req.params.id, req.user.id]);
  const n = (await db.query("SELECT count(*)::int AS n FROM event_rsvps WHERE event_id=$1", [req.params.id])).rows[0].n;
  res.json({ going: !del.rowCount, rsvps: n });
});

module.exports = router;
