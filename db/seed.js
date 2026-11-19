// Idempotent seed: catalog objects + the global recommender model's prior weights.
const { pool } = require("../src/db");
const { DSO, PLANETS } = require("./catalog");
const { priorWeights } = require("../src/ml/model");

async function seed({ quiet = false } = {}) {
  for (const [slug, name, cat, type, ra, dec, mag, size, con, desc] of DSO) {
    await pool.query(
      `INSERT INTO objects(slug,name,catalog_id,type,ra_hours,dec_deg,magnitude,size_arcmin,constellation,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, ra_hours=EXCLUDED.ra_hours, dec_deg=EXCLUDED.dec_deg,
         magnitude=EXCLUDED.magnitude, size_arcmin=EXCLUDED.size_arcmin, description=EXCLUDED.description`,
      [slug, name, cat, type, ra, dec, mag, size, con, desc]);
  }
  for (const [slug, name, size, desc] of PLANETS) {
    await pool.query(
      `INSERT INTO objects(slug,name,type,size_arcmin,description) VALUES ($1,$2,'planet',$3,$4)
       ON CONFLICT (slug) DO UPDATE SET description=EXCLUDED.description`, [slug, name, size, desc]);
  }
  await pool.query(`INSERT INTO global_model(id, weights) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(priorWeights())]);
  if (!quiet) console.log(`seeded ${DSO.length} deep-sky objects + ${PLANETS.length} planets`);
}
module.exports = seed;
if (require.main === module) seed().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
