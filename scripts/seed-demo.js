// Seeds a demo account over HTTP, so it works against localhost or the deployed site:
//   node scripts/seed-demo.js http://localhost:4000
//   node scripts/seed-demo.js https://almagest.onrender.com
// The demo user rates nebulae and clusters highly and galaxies low (a realistic Bortle-6 pattern),
// so the recommender visibly personalises. Re-running is safe: it signs in if the account exists and adds nothing if it already has observations.
const base = (process.argv[2] || "http://localhost:4000").replace(/\/$/, "");
const EMAIL = "demo@almagest.dev", PASS = "DemoPass123";
let cookie = "";
async function call(path, method = "GET", body) {
  const res = await fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, data };
}
(async () => {
  // Render's free tier sleeps: wait for the first response.
  for (let i = 0; i < 20; i++) { try { if ((await call("/health")).status) break; } catch { /* waking */ } await new Promise((r) => setTimeout(r, 5000)); }
  let r = await call("/auth/signup", "POST", { email: EMAIL, password: PASS, displayName: "Demo Observer" });
  if (r.status === 409) r = await call("/auth/login", "POST", { email: EMAIL, password: PASS });
  if (![200, 201].includes(r.status)) throw new Error("auth failed: " + r.status + " " + JSON.stringify(r.data));
  r = await call("/profile", "PUT", { lat: 12.82, lon: 80.04, locationName: "Kattankulathur, India", bortle: 6, apertureMm: 100, experience: "intermediate", minAlt: 20 });
  if (r.status !== 200) throw new Error("profile failed " + JSON.stringify(r.data));
  const have = (await call("/observations")).data.observations.length;
  if (have) { console.log(`Demo account already has ${have} observations; nothing to add.`); return; }
  const objs = (await call("/objects")).data.objects, by = (n) => objs.find((o) => o.name === n);
  const plan = [ // [name, daysAgo, rating]
    ["Orion Nebula", 1, 5], ["Pleiades", 2, 5], ["Ring Nebula", 3, 4], ["Hercules Cluster", 4, 5], ["Dumbbell Nebula", 5, 4], ["Beehive Cluster", 6, 4],
    ["Andromeda Galaxy", 7, 2], ["Whirlpool Galaxy", 8, 1], ["Triangulum Galaxy", 9, 1], ["Sombrero Galaxy", 10, 2], ["Double Cluster", 11, 5], ["Albireo", 12, 4], ["Saturn", 13, 4], ["Jupiter", 14, 5],
  ];
  let n = 0;
  for (const [name, d, rating] of plan) {
    const o = by(name); if (!o) { console.log("skip (not in catalog):", name); continue; }
    const t = new Date(); t.setUTCDate(t.getUTCDate() - d); t.setUTCHours(16, 0, 0, 0);
    const x = await call("/observations", "POST", { objectId: o.id, observedAt: t.toISOString(), lat: 12.82, lon: 80.04, seeing: 3, transparency: 3, rating, equipment: "100 mm refractor", notes: "Demo entry" });
    if (x.status === 201) n++; else console.log("failed:", name, x.status, JSON.stringify(x.data));
  }
  console.log(`Demo ready on ${base}: ${EMAIL} / ${PASS} (${n} observations logged)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
