const express = require("express");
const { z } = require("zod");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const galaxy = require("../ml/galaxy");

const router = express.Router();

router.get("/status", async (req, res) => res.json(await galaxy.status()));

const body = z.object({ pixels: z.string().min(100).max(300000).regex(/^[A-Za-z0-9+/]+=*$/, "pixels must be base64") });
router.post("/classify", validate(body), async (req, res) => {
  const rgb = Buffer.from(req.body.pixels, "base64");
  let result;
  try { result = await galaxy.classify(rgb); }
  catch (e) { if (e.status === 400) throw new HttpError(400, e.message); throw e; }
  if (!result) throw new HttpError(503, "The galaxy model isn't installed on this server. Train it with ml-galaxy/train.py (see README).");
  res.json({ predictions: result });
});

module.exports = router;
