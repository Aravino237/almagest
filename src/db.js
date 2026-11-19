const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 20000, connectionTimeoutMillis: 15000 }); // short idle: Neon suspends idle compute
pool.on("error", (err) => console.error("[db] idle client error", err.message));

async function query(text, params) {
  return pool.query(text, params);
}

// Run fn(client) inside BEGIN/COMMIT, rolling back on any error.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
