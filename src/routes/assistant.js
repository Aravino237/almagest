const express = require("express");
const { z } = require("zod");
const db = require("../db");
const mongo = require("../mongo");
const validate = require("../middleware/validate");
const { optionalAuth } = require("../middleware/auth");
const svc = require("../services/recommender-service");
const ai = require("../ai/assistant");

const router = express.Router();
const GUEST = { lat: 12.82, lon: 80.04, location_name: "Kattankulathur, India", bortle: 6, aperture_mm: 0, experience: "beginner", min_alt: 15 };

const body = z.object({
  message: z.string().trim().min(2).max(300),
  tzOffsetMin: z.number().int().min(-720).max(840).default(0),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
});

// POST /api/assistant { message } -> grounded answer plus which tools produced it.
router.post("/", optionalAuth, validate(body), async (req, res) => {
  const profile = { ...(req.user ? await svc.getProfile(req.user.id) : GUEST) };
  if (req.body.lat !== undefined && req.body.lon !== undefined) { profile.lat = req.body.lat; profile.lon = req.body.lon; profile.location_name = "Custom location"; }
  const objects = (await db.query("SELECT * FROM objects ORDER BY id")).rows;
  const out = await ai.answer(req.body.message, { user: req.user || null, profile, objects, now: new Date(), tz: req.body.tzOffsetMin, svc, db, mongo });
  res.json(out);
});

module.exports = router;
