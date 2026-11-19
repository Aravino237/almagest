// MongoDB connection (hybrid design):
//   PostgreSQL: users, profiles, the object catalog, community events, model weights (relational, constrained)
//   MongoDB:    the observation logbook and the recommender's training examples (document-shaped, evolving fields)
const { MongoClient, ObjectId } = require("mongodb");
const config = require("./config");

let client = null, db = null, connecting = null;

async function ensureIndexes(d) {
  await d.collection("observations").createIndex({ userId: 1, observedAt: -1 });
  await d.collection("feedback").createIndex({ userId: 1, createdAt: 1 });
  await d.collection("feedback").createIndex({ observationId: 1 });
}

async function getDb() {
  if (db) return db;
  if (!connecting) {
    connecting = (async () => {
      const c = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
      try { await c.connect(); } catch (e) {
        connecting = null;
        throw new Error(`Cannot reach MongoDB (${config.mongoUri.replace(/\/\/[^@]*@/, "//***@")}): ${e.message}. Local: brew services start mongodb-community. Cloud: check MONGODB_URI and Atlas Network Access (allow 0.0.0.0/0).`);
      }
      client = c; db = c.db(config.mongoDb);
      await ensureIndexes(db);
      return db;
    })();
  }
  return connecting;
}

const col = async (name) => (await getDb()).collection(name);

// Parse a client-supplied id; null if it isn't a valid ObjectId.
function toObjectId(str) {
  return typeof str === "string" && /^[0-9a-f]{24}$/i.test(str) ? new ObjectId(str) : null;
}

async function ping() { await (await getDb()).command({ ping: 1 }); }
async function close() { if (client) await client.close(); client = db = connecting = null; }

module.exports = { getDb, col, toObjectId, ObjectId, ping, close };
