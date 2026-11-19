// Test harness: a separate database (almagest_test) that is created, migrated, seeded
// and wiped before each test file. Never touches almagest_prod.
const { Client } = require("pg");
const config = require("../src/config");
const mongo = require("../src/mongo");

async function resetDb() {
  if (!/almagest_test$/.test(config.databaseUrl)) throw new Error("Refusing to run tests against " + config.databaseUrl);
  const url = new URL(config.databaseUrl); const name = url.pathname.slice(1); url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])).rowCount) await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  await require("../db/migrate")({ quiet: true });
  const { pool } = require("../src/db");
  await pool.query("TRUNCATE users, community_events, feedback, observations, user_models RESTART IDENTITY CASCADE");
  await pool.query("DELETE FROM global_model");
  await require("../db/seed")({ quiet: true });
  if (!/_test$/.test(config.mongoDb)) throw new Error("Refusing to wipe MongoDB database " + config.mongoDb);
  await (await mongo.getDb()).dropDatabase();
  await mongo.close();            // reconnect so indexes are rebuilt on the fresh database
  await mongo.getDb();
}

async function signup(agent, email = "a@test.dev", password = "password123", displayName = "Tester") {
  const r = await agent.post("/api/auth/signup").send({ email, password, displayName });
  if (r.status !== 201) throw new Error("signup failed " + r.status + JSON.stringify(r.body));
  return r.body.user;
}

module.exports = { resetDb, signup };
