// One-time, safe-to-repeat copy of the logbook and training examples that earlier versions
// kept in PostgreSQL (tables `observations` and `feedback`) into MongoDB.
// It never deletes anything from PostgreSQL; re-running skips rows already copied.
const db = require("../src/db");
const mongo = require("../src/mongo");

(async () => {
  const obsCol = await mongo.col("observations"), fbCol = await mongo.col("feedback");
  const has = await db.query("SELECT to_regclass('public.observations') AS o, to_regclass('public.feedback') AS f");
  if (!has.rows[0].o) { console.log("No old observations table: nothing to migrate."); return; }

  const done = new Set((await obsCol.find({ legacyPgId: { $exists: true } }, { projection: { legacyPgId: 1 } }).toArray()).map((d) => d.legacyPgId));
  const idMap = new Map((await obsCol.find({ legacyPgId: { $exists: true } }, { projection: { legacyPgId: 1 } }).toArray()).map((d) => [d.legacyPgId, d._id]));
  const rows = (await db.query(`SELECT obs.*, o.type FROM observations obs LEFT JOIN objects o ON o.id = obs.object_id ORDER BY obs.id`)).rows;
  let copied = 0;
  for (const r of rows) {
    if (done.has(r.id)) continue;
    const ins = await obsCol.insertOne({
      userId: r.user_id, objectId: r.object_id, objectType: r.type || "other", targetName: r.target_name, observedAt: r.observed_at,
      location: { lat: r.lat, lon: r.lon }, conditions: { seeing: r.seeing, transparency: r.transparency },
      rating: r.rating, equipment: r.equipment, notes: r.notes, createdAt: r.created_at, legacyPgId: r.id });
    idMap.set(r.id, ins.insertedId); copied++;
  }

  let fbCopied = 0;
  if (has.rows[0].f) {
    const doneFb = new Set((await fbCol.find({ legacyPgId: { $exists: true } }, { projection: { legacyPgId: 1 } }).toArray()).map((d) => d.legacyPgId));
    const fb = (await db.query(`SELECT f.*, o.type FROM feedback f JOIN objects o ON o.id = f.object_id ORDER BY f.id`)).rows;
    for (const f of fb) {
      if (doneFb.has(f.id)) continue;
      await fbCol.insertOne({ userId: f.user_id, objectId: f.object_id, objectType: f.type, label: f.label, source: f.source,
        observationId: f.observation_id ? idMap.get(f.observation_id) || null : null, features: f.features, createdAt: f.created_at, legacyPgId: f.id });
      fbCopied++;
    }
  }
  console.log(`Copied ${copied} observations and ${fbCopied} training examples to MongoDB (${rows.length} observations found in PostgreSQL).`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => Promise.all([db.pool.end(), mongo.close()]));
