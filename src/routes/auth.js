const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const db = require("../db");
const config = require("../config");
const validate = require("../middleware/validate");
const { HttpError } = require("../middleware/errors");
const { sign, setAuthCookie, requireAuth } = require("../middleware/auth");

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60e3, limit: config.env === "test" ? 1000 : 20, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many attempts, try again in a few minutes" } });

const email = z.string().trim().toLowerCase().email().max(200);
const signupSchema = z.object({
  email, displayName: z.string().trim().min(1).max(60),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 4);

router.post("/signup", limiter, validate(signupSchema), async (req, res) => {
  const { email, password, displayName } = req.body;
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const user = await db.tx(async (c) => {
    const exists = await c.query("SELECT 1 FROM users WHERE email=$1", [email]);
    if (exists.rowCount) throw new HttpError(409, "An account with that email already exists");
    const u = (await c.query("INSERT INTO users(email,password_hash,display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name",
      [email, hash, displayName])).rows[0];
    await c.query("INSERT INTO profiles(user_id) VALUES ($1)", [u.id]);
    return u;
  });
  setAuthCookie(res, sign(user));
  res.status(201).json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
});

router.post("/login", limiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const user = (await db.query("SELECT id, email, display_name, password_hash FROM users WHERE email=$1", [email])).rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Invalid email or password");
  setAuthCookie(res, sign(user));
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
});

router.post("/logout", (req, res) => {
  res.clearCookie(config.cookieName, { path: "/" });
  res.status(204).end();
});

router.get("/me", requireAuth, async (req, res) => {
  const u = (await db.query("SELECT id, email, display_name, created_at FROM users WHERE id=$1", [req.user.id])).rows[0];
  if (!u) throw new HttpError(401, "Account no longer exists");
  res.json({ user: { id: u.id, email: u.email, displayName: u.display_name, createdAt: u.created_at } });
});

module.exports = router;
