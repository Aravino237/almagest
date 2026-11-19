const createApp = require("./src/app");
const config = require("./src/config");
const { pool } = require("./src/db");
const mongo = require("./src/mongo");

let server;
const bootstrap = async () => {
  if (process.env.AUTO_SETUP === "1") { // cloud: create tables and seed the catalog on boot (both are idempotent)
    await require("./db/migrate")({ quiet: true }); await require("./db/seed")({ quiet: true });
  }
  await mongo.getDb();
};
bootstrap().then(() => {
  server = createApp().listen(config.port, () => console.log(`Almagest is running at http://localhost:${config.port}  (PostgreSQL + MongoDB "${config.mongoDb}")`));
}).catch((e) => { console.error("\n" + e.message + "\n"); process.exit(1); });
const shutdown = () => { const done = () => Promise.all([pool.end(), mongo.close()]).then(() => process.exit(0)); server ? server.close(done) : done(); setTimeout(() => process.exit(0), 3000).unref(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
