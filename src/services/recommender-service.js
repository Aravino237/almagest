// Side of the recommender that touches databases:
//   - model weights (global + per user) live in PostgreSQL, updated inside a transaction with row locks;
//   - training examples (`feedback`) and the user's logbook live in MongoDB.
const db = require("../db");
const mongo = require("../mongo");
const M = require("../ml/model");
const R = require("../ml/recommender");
const sky = require("../astro/sky");

const zeros = () => new Array(M.DIM).fill(0);

async function getProfile(userId) {
  const r = await db.query("SELECT * FROM profiles WHERE user_id=$1", [userId]);
  return r.rows[0];
}

async function loadModel(userId) {
  const g = (await db.query("SELECT weights, n_updates FROM global_model WHERE id=1")).rows[0];
  const u = userId ? (await db.query("SELECT delta, n_updates FROM user_models WHERE user_id=$1", [userId])).rows[0] : null;
  return { wGlobal: g ? g.weights : M.priorWeights(), globalUpdates: g ? g.n_updates : 0,
    delta: u ? u.delta : zeros(), userUpdates: u ? u.n_updates : 0 };
}

// Which objects this user has rated or logged, and how many examples per object type.
async function userHistory(userId) {
  if (!userId) return { seen: new Set(), typeCounts: {} };
  const group = (c) => c.aggregate([{ $match: { userId } },
    { $group: { _id: { objectId: "$objectId", type: "$objectType" }, n: { $sum: 1 } } }]).toArray();
  const [fb, obs] = await Promise.all([mongo.col("feedback").then(group), mongo.col("observations").then(group)]);
  const seen = new Set(), typeCounts = {};
  for (const row of [...fb, ...obs]) {
    if (row._id.objectId == null) continue;
    seen.add(row._id.objectId);
    typeCounts[row._id.type] = (typeCounts[row._id.type] || 0) + row.n;
  }
  return { seen, typeCounts };
}

async function plan(userId, profile, date) {
  const objects = (await db.query("SELECT * FROM objects ORDER BY id")).rows;
  const [model, hist] = await Promise.all([loadModel(userId), userHistory(userId)]);
  const out = R.buildPlan({ date, profile, objects, seen: hist.seen, typeCounts: hist.typeCounts, wGlobal: model.wGlobal, delta: model.delta });
  out.model = { personalised: model.userUpdates > 0, userExamples: model.userUpdates, globalUpdates: model.globalUpdates };
  return out;
}

// Re-fit a user's personal offset by replaying all their stored examples (keeps the model
// consistent when logs are edited or deleted). Global weights are held fixed.
async function retrainUser(client, userId) {
  const g = (await client.query("SELECT weights FROM global_model WHERE id=1")).rows[0].weights;
  const ex = await (await mongo.col("feedback")).find({ userId }).sort({ createdAt: 1, _id: 1 }).toArray();
  let delta = zeros();
  for (let epoch = 0; epoch < 3; epoch++)
    for (const e of ex) delta = M.sgdStep(g, delta, e.features, e.label).delta;
  await client.query(
    `INSERT INTO user_models(user_id, delta, n_updates, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (user_id) DO UPDATE SET delta=EXCLUDED.delta, n_updates=EXCLUDED.n_updates, updated_at=now()`,
    [userId, JSON.stringify(delta.map((v) => +v.toFixed(5))), ex.length]);
  return { delta, examples: ex.length };
}

// Learn from one new labelled example: store it (MongoDB), take one online step on the
// global model, then refit the user's personal offset (PostgreSQL, in one transaction).
async function learn(userId, objectId, label, source, at, lat, lon, observationId = null, replaceRecentThumbs = false) {
  const obj = (await db.query("SELECT * FROM objects WHERE id=$1", [objectId])).rows[0];
  if (!obj) return null;
  const profile = { ...(await getProfile(userId)), lat, lon };
  const feedback = await mongo.col("feedback"), observations = await mongo.col("observations");
  // Novelty is judged as of *before* this example (ignore the observation being learned from).
  const priorCount = await feedback.countDocuments({ userId, objectId })
    + await observations.countDocuments({ userId, objectId, ...(observationId ? { _id: { $ne: observationId } } : {}) });
  const moon = sky.moon(at, lat, lon);
  const { x, ctx } = R.contextFor(obj, at, profile, moon, priorCount > 0);

  if (replaceRecentThumbs)
    await feedback.deleteMany({ userId, objectId, source: "thumbs", createdAt: { $gt: new Date(Date.now() - 12 * 3600e3) } });
  await feedback.insertOne({ userId, objectId, objectType: obj.type, label, source, observationId, features: x, createdAt: new Date() });

  return db.tx(async (client) => {
    const g = (await client.query("SELECT weights FROM global_model WHERE id=1 FOR UPDATE")).rows[0];
    const u = (await client.query("SELECT delta FROM user_models WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
    const step = M.sgdStep(g.weights, u ? u.delta : zeros(), x, label);
    await client.query("UPDATE global_model SET weights=$1, n_updates=n_updates+1, updated_at=now() WHERE id=1",
      [JSON.stringify(step.wGlobal.map((v) => +v.toFixed(5)))]);
    const r = await retrainUser(client, userId);
    return { predictedBefore: +step.p.toFixed(3), label, examples: r.examples, alt: +ctx.alt.toFixed(1) };
  });
}

module.exports = { plan, learn, retrainUser, loadModel, getProfile, userHistory };
