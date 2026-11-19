const express = require("express");
const { z } = require("zod");
const db = require("../db");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const sky = require("../astro/sky");
const M = require("../ml/model");

const router = express.Router();

const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  type: z.enum(M.TYPES).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

router.get("/", validate(listQuery, "query"), async (req, res) => {
  const { q, type, lat, lon } = req.validQuery;
  const params = [], where = [];
  if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR catalog_id ILIKE $${params.length} OR constellation ILIKE $${params.length})`); }
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  const rows = (await db.query(`SELECT * FROM objects ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY type, name`, params)).rows;
  const now = new Date();
  res.json({
    objects: rows.map((o) => {
      const out = { id: o.id, slug: o.slug, name: o.name, catalogId: o.catalog_id, type: o.type, constellation: o.constellation,
        magnitude: o.magnitude, sizeArcmin: o.size_arcmin, description: o.description };
      if (lat !== undefined && lon !== undefined) {
        const p = sky.position(o, now, lat, lon);
        out.altNow = +p.alt.toFixed(1); out.magnitude = +p.mag.toFixed(1);
      }
      return out;
    }),
  });
});

const trackQuery = z.object({
  lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180),
  start: z.coerce.date().optional(), hours: z.coerce.number().min(1).max(24).default(12),
});
router.get("/:slug/track", validate(trackQuery, "query"), async (req, res) => {
  const o = (await db.query("SELECT * FROM objects WHERE slug=$1", [req.params.slug])).rows[0];
  if (!o) throw new HttpError(404, "Unknown object");
  const { lat, lon, hours } = req.validQuery;
  const start = req.validQuery.start || new Date();
  res.json({ object: { slug: o.slug, name: o.name }, points: sky.track(o, start, hours, 15, lat, lon) });
});

module.exports = router;
