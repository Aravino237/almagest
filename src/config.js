// Central configuration. Reads a local .env file (KEY=VALUE lines) if present,
// then falls back to safe local-development defaults.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env.NODE_ENV || "development";
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (env === "production") throw new Error("JWT_SECRET must be set in production");
  jwtSecret = crypto.randomBytes(32).toString("hex");
  if (env !== "test") console.warn("[config] JWT_SECRET not set: using a random one (logins reset on restart). Copy .env.example to .env.");
}

module.exports = {
  env,
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  mongoDb: process.env.MONGODB_DB || (env === "test" ? "almagest_test" : "almagest_prod"),
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres:almagest@localhost:5432/almagest_prod",
  jwtSecret,
  jwtTtlSeconds: 7 * 24 * 3600,
  cookieName: "almagest_token",
  bcryptRounds: env === "test" ? 4 : 11,
};
