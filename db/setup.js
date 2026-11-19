// One-shot setup: create the database if missing, migrate, seed.
const { Client } = require("pg");
const config = require("../src/config");

(async () => {
  const url = new URL(config.databaseUrl);
  const dbName = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  try {
    await admin.connect();
  } catch (e) {
    console.error(`Could not connect to PostgreSQL at ${url.host}: ${e.message}\nIs Postgres.app running, and is the password in DATABASE_URL right?`);
    process.exit(1);
  }
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]);
  if (!exists.rowCount) { await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`); console.log("created database", dbName); }
  await admin.end();
  const migrate = require("./migrate"); const seed = require("./seed"); const { pool } = require("../src/db");
  await migrate(); await seed(); await pool.end();
  console.log("setup complete");
})().catch((e) => { console.error(e); process.exit(1); });
