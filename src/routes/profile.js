const express = require("express");
const { z } = require("zod");
const db = require("../db");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const sky = require("../astro/sky");

const router = express.Router();
router.use(requireAuth);

const shape = (p) => ({ lat: p.lat, lon: p.lon, locationName: p.location_name, bortle: p.bortle, apertureMm: p.aperture_mm,
  experience: p.experience, minAlt: p.min_alt, limitingMagnitude: +sky.limitingMagnitude(p.bortle, p.aperture_mm).toFixed(1) });

router.get("/", async (req, res) => {
  const p = (await db.query("SELECT * FROM profiles WHERE user_id=$1", [req.user.id])).rows[0];
  res.json({ profile: shape(p) });
});

const schema = z.object({
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  locationName: z.string().trim().min(1).max(80),
  bortle: z.number().int().min(1).max(9), apertureMm: z.number().int().min(0).max(2000),
  experience: z.enum(["beginner", "intermediate", "advanced"]), minAlt: z.number().int().min(0).max(60),
});

router.put("/", validate(schema), async (req, res) => {
  const b = req.body;
  const p = (await db.query(
    `UPDATE profiles SET lat=$2, lon=$3, location_name=$4, bortle=$5, aperture_mm=$6, experience=$7, min_alt=$8, updated_at=now()
     WHERE user_id=$1 RETURNING *`, [req.user.id, b.lat, b.lon, b.locationName, b.bortle, b.apertureMm, b.experience, b.minAlt])).rows[0];
  res.json({ profile: shape(p) });
});

module.exports = router;
