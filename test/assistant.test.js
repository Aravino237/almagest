const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, signup } = require("./helpers");
const createApp = require("../src/app");
const { pool } = require("../src/db");
const mongo = require("../src/mongo");
const { classify, extractObject } = require("../src/ai/assistant");

let app;
test.before(async () => { await resetDb(); app = createApp(); });
test.after(async () => { await pool.end(); await mongo.close(); });
const ask = (agent, message) => agent.post("/api/assistant").send({ message });

test("classifier routes canonical questions", () => {
  assert.equal(classify("what should I observe tonight").intent, "plan");
  assert.equal(classify("what phase is the moon").intent, "moon");
  assert.equal(classify("when is the next meteor shower").intent, "events");
});

test("entity extraction prefers the longest name", () => {
  const objs = [{ name: "Orion Nebula", catalog_id: "M42", slug: "m42" }, { name: "Nebula", catalog_id: "X", slug: "x" }];
  assert.equal(extractObject("tell me about the orion nebula", objs).slug, "m42");
  assert.equal(extractObject("is m42 up", objs).slug, "m42");
});

test("validation rejects empty and oversized messages", async () => {
  assert.equal((await ask(request(app), "")).status, 400);
  assert.equal((await ask(request(app), "x".repeat(301))).status, 400);
});

test("guest: plan answer comes from the recommender", async () => {
  const r = await ask(request(app), "what should I observe tonight");
  assert.equal(r.status, 200); assert.equal(r.body.intent, "plan");
  assert.ok(r.body.tools.includes("recommender")); assert.match(r.body.answer, /Top picks|Nothing clears/);
});

test("position answer matches the ephemeris", async () => {
  const sky = require("../src/astro/sky");
  const r = await ask(request(app), "is Saturn visible now");
  assert.equal(r.status, 200); assert.equal(r.body.object, "saturn");
  const obj = (await pool.query("SELECT * FROM objects WHERE slug='saturn'")).rows[0];
  const alt = sky.position(obj, new Date(), 12.82, 80.04).alt;
  assert.ok(Math.abs(r.body.data.alt - alt) < 1, `alt ${r.body.data.alt} vs ${alt}`);
});

test("about an object uses the catalog description", async () => {
  const r = await ask(request(app), "tell me about the Crab Nebula");
  assert.match(r.body.answer, /1054/); assert.equal(r.body.object, "m1");
});

test("gibberish does not invent an answer", async () => {
  const r = await ask(request(app), "qwzx vbnm plorf");
  assert.equal(r.body.intent, "unknown"); assert.deepEqual(r.body.tools, []);
});

test("signed-in: stats count real MongoDB observations", async () => {
  const agent = request.agent(app); await signup(agent);
  let r = await ask(agent, "how many observations have I logged");
  assert.match(r.body.answer, /empty/);
  const obj = (await pool.query("SELECT id FROM objects WHERE slug='m42'")).rows[0];
  const p = await agent.post("/api/observations").send({ objectId: obj.id, observedAt: new Date(Date.now() - 3600e3).toISOString(), rating: 5, seeing: 3, transparency: 3, lat: 12.82, lon: 80.04 });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  r = await ask(agent, "how many observations have I logged");
  assert.equal(r.body.data.total, 1); assert.match(r.body.answer, /Orion Nebula/);
});

test("guest is asked to sign in for personal questions", async () => {
  const r = await ask(request(app), "what do I like to observe");
  assert.match(r.body.answer, /Sign in/);
});
