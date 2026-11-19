const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resetDb, signup } = require("./helpers");
const createApp = require("../src/app");
const { pool } = require("../src/db");
const mongo = require("../src/mongo");

let app;
test.before(async () => { await resetDb(); app = createApp(); });
test.after(async () => { await pool.end(); await mongo.close(); });

test("health check reports the database", async () => {
  const r = await request(app).get("/api/health");
  assert.equal(r.status, 200); assert.equal(r.body.db, "up"); assert.equal(r.body.mongo, "up");
});

test("security headers are set", async () => {
  const r = await request(app).get("/index.html");
  assert.match(r.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(r.headers["x-powered-by"], undefined);
});

test("signup validates input", async () => {
  const r = await request(app).post("/api/auth/signup").send({ email: "nope", password: "short", displayName: "" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details.map((d) => d.field).sort(), ["displayName", "email", "password"]);
});

test("signup, duplicate, login, me, logout", async () => {
  const agent = request.agent(app);
  const u = await signup(agent, "Star@Test.dev");
  assert.equal(u.email, "star@test.dev");
  assert.equal((await request(app).post("/api/auth/signup").send({ email: "star@test.dev", password: "password123", displayName: "x" })).status, 409);
  const bad = await request(app).post("/api/auth/login").send({ email: "star@test.dev", password: "wrongpass" });
  assert.equal(bad.status, 401);
  const ghost = await request(app).post("/api/auth/login").send({ email: "ghost@test.dev", password: "wrongpass" });
  assert.equal(ghost.body.error, bad.body.error, "same error for unknown email and wrong password");
  const login = await request(app).post("/api/auth/login").send({ email: "star@test.dev", password: "password123" });
  assert.equal(login.status, 200); assert.match(login.headers["set-cookie"][0], /HttpOnly/);
  assert.equal((await agent.get("/api/auth/me")).body.user.displayName, "Tester");
  await agent.post("/api/auth/logout");
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("protected routes need a session; malformed input is rejected cleanly", async () => {
  assert.equal((await request(app).get("/api/observations")).status, 401);
  assert.equal((await request(app).get("/api/profile")).status, 401);
  const bad = await request(app).post("/api/plan").set("Content-Type", "application/json").send("{oops");
  assert.equal(bad.status, 400);
  assert.equal((await request(app).get("/api/nope")).status, 404);
});

test("profile update is validated and changes the limiting magnitude", async () => {
  const agent = request.agent(app); await signup(agent, "p@test.dev");
  const body = { lat: 12.82, lon: 80.04, locationName: "SRM", bortle: 4, apertureMm: 200, experience: "advanced", minAlt: 20 };
  assert.equal((await agent.put("/api/profile").send({ ...body, bortle: 12 })).status, 400);
  const r = await agent.put("/api/profile").send(body);
  assert.equal(r.status, 200); assert.equal(r.body.profile.limitingMagnitude, 13.6);
});

test("observations: CRUD, ownership, learning and plausibility warning", async () => {
  const a = request.agent(app), b = request.agent(app);
  await signup(a, "obs-a@test.dev"); await signup(b, "obs-b@test.dev");
  const base = { objectId: 16, observedAt: "2026-10-15T15:30:00Z", lat: 12.82, lon: 80.04, seeing: 4, transparency: 4, rating: 5 };
  const c = await a.post("/api/observations").send(base);
  assert.equal(c.status, 201); assert.equal(c.body.observation.targetName, "Andromeda Galaxy");
  assert.equal(c.body.learned.examples, 1); assert.equal(c.body.warning, null);
  const below = await a.post("/api/observations").send({ ...base, observedAt: "2026-10-15T05:00:00Z" });
  assert.match(below.body.warning, /below the horizon/);
  assert.equal((await a.post("/api/observations").send({ ...base, objectId: null })).status, 400);
  const id = c.body.observation.id;
  assert.equal((await b.delete(`/api/observations/${id}`)).status, 404, "other users cannot delete it");
  assert.equal((await b.get("/api/observations")).body.observations.length, 0);
  assert.equal((await a.put(`/api/observations/${id}`).send({ ...base, rating: 2 })).status, 200);
  assert.equal((await a.get("/api/observations/stats")).body.total, 2);
  assert.equal((await a.delete(`/api/observations/${id}`)).status, 204);
  assert.equal((await a.get("/api/model/me")).body.examples, 1, "model refit after delete");
  assert.equal((await a.delete("/api/observations/abc")).status, 400);
  assert.equal((await a.delete("/api/observations/" + "0".repeat(24))).status, 404);
});

test("observation insights are aggregated per user in MongoDB", async () => {
  const a = request.agent(app), b = request.agent(app);
  await signup(a, "ins-a@test.dev"); await signup(b, "ins-b@test.dev");
  const mk = (objectId, seeing, rating) => ({ objectId, observedAt: "2026-10-15T15:30:00Z", lat: 12.82, lon: 80.04, seeing, transparency: 3, rating });
  for (const o of [mk(16, 5, 5), mk(16, 5, 4), mk(16, 2, 2), mk(17, 4, 3)]) assert.equal((await a.post("/api/observations").send(o)).status, 201);
  await b.post("/api/observations").send(mk(16, 1, 1));
  const r = (await a.get("/api/observations/insights")).body;
  const s5 = r.bySeeing.find((x) => x.seeing === 5), s2 = r.bySeeing.find((x) => x.seeing === 2);
  assert.equal(s5.n, 2); assert.equal(s5.avgRating, 4.5); assert.equal(s2.avgRating, 2);
  assert.equal(r.topTargets[0].target, "Andromeda Galaxy"); assert.equal(r.topTargets[0].n, 3);
  assert.equal(r.byType.find((x) => x.type === "galaxy").n, 4, "other users' logs are excluded");
  const st = (await a.get("/api/observations/stats")).body;
  assert.equal(st.total, 4); assert.equal(st.distinct_objects, 2); assert.equal(st.avg_rating, 3.5);
});

test("feedback trains the personal model and shows up in plans", async () => {
  const agent = request.agent(app); await signup(agent, "fb@test.dev");
  const at = "2026-10-15T15:30:00Z";
  const before = await agent.post("/api/plan").send({ at });
  assert.equal(before.body.model.personalised, false);
  for (const id of [16, 17, 38, 22]) assert.equal((await agent.post("/api/feedback").send({ objectId: id, liked: true, at })).status, 201);
  const m = (await agent.get("/api/model/me")).body;
  assert.equal(m.examples, 4);
  assert.ok(m.affinities.find((a) => a.type === "galaxy").personal > 0.3);
  const after = await agent.post("/api/plan").send({ at });
  assert.equal(after.body.model.personalised, true);
  assert.equal((await agent.post("/api/feedback").send({ objectId: 99999, liked: true, at })).status, 404);
  assert.equal((await agent.delete("/api/model/me")).status, 204);
  assert.equal((await agent.get("/api/model/me")).body.examples, 0);
});

test("guests get a plan from the community model", async () => {
  const r = await request(app).post("/api/plan").send({ at: "2026-10-15T15:30:00Z", lat: 51.48, lon: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.location.name, "Custom location");
  assert.ok(r.body.recommendations.length > 0);
});

test("community events: create, RSVP toggle, only the host can delete", async () => {
  const host = request.agent(app), guest = request.agent(app);
  await signup(host, "host@test.dev"); await signup(guest, "guest@test.dev");
  assert.equal((await host.post("/api/events/community").send({ title: "x", startsAt: "2020-01-01", locationName: "" })).status, 400);
  const e = await host.post("/api/events/community").send({ title: "Rooftop session", startsAt: "2030-01-01T14:00:00Z", locationName: "SRM KTR" });
  assert.equal(e.status, 201);
  const id = e.body.event.id;
  assert.equal((await guest.post(`/api/events/community/${id}/rsvp`)).body.rsvps, 2);
  assert.equal((await guest.post(`/api/events/community/${id}/rsvp`)).body.going, false);
  assert.equal((await guest.delete(`/api/events/community/${id}`)).status, 404);
  assert.equal((await host.delete(`/api/events/community/${id}`)).status, 204);
  const sky = await request(app).get("/api/events/sky?days=60");
  assert.ok(sky.body.events.length > 5);
});

test("galaxy classifier reports 'not installed' cleanly when no model file exists", async () => {
  const s = await request(app).get("/api/galaxy/status");
  assert.equal(s.status, 200);
  if (s.body.available) return;            // a trained model is installed on this machine: nothing to check
  const r = await request(app).post("/api/galaxy/classify").send({ pixels: "A".repeat(200) });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /isn't installed/);
  assert.equal((await request(app).post("/api/galaxy/classify").send({ pixels: "not base64!!" + "a".repeat(100) })).status, 400);
});
