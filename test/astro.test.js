const test = require("node:test");
const assert = require("node:assert/strict");
const sky = require("../src/astro/sky");
const { computeEvents } = require("../src/astro/events");

// Reference values computed independently with astropy 7 (ICRS -> AltAz, no refraction)
// for 2026-10-15 15:30 UTC at 12.82°N, 80.04°E.
const AT = new Date("2026-10-15T15:30:00Z"), LAT = 12.82, LON = 80.04;
const fixed = (ra, dec) => ({ type: "galaxy", ra_hours: ra, dec_deg: dec, magnitude: 1 });

test("fixed-object altitude matches astropy (below-horizon, no refraction)", () => {
  assert.ok(Math.abs(sky.position(fixed(5.5881, -5.3911), AT, LAT, LON).alt - -18.1585) < 0.02);
});
test("high object altitude matches astropy within refraction (~1 arcmin)", () => {
  const a = sky.position(fixed(0.7123, 41.2692), AT, LAT, LON).alt;
  assert.ok(a > 48.6378 && a - 48.6378 < 0.05, `got ${a}`);
});
test("planet altitude matches astropy", () => {
  assert.ok(Math.abs(sky.position({ type: "planet", slug: "jupiter" }, AT, LAT, LON).alt - -59.9273) < 0.02);
});
test("moon illumination matches astropy", () => {
  assert.ok(Math.abs(sky.moon(AT, LAT, LON).illumination - 0.22914) < 0.005);
});
test("limiting magnitude: aperture adds 5·log10(D/7)", () => {
  assert.equal(sky.limitingMagnitude(6, 0), 5.5);
  assert.ok(Math.abs(sky.limitingMagnitude(6, 200) - (5.5 + 5 * Math.log10(200 / 7))) < 1e-9);
  assert.ok(sky.limitingMagnitude(1, 2000) <= 16);
});
test("dark window: dusk precedes dawn and the Sun is at -18° then", () => {
  const w = sky.darkWindow(new Date("2026-10-15T06:00:00Z"), LAT, LON);
  assert.ok(w.dusk < w.dawn);
  assert.ok(Math.abs(sky.sunAltitude(w.dusk, LAT, LON) + 18) < 0.05);
});
test("computed events are sorted and include known 2027 events", () => {
  const ev = computeEvents(new Date("2026-10-15T00:00:00Z"), 130);
  assert.deepEqual(ev.map((e) => e.date), [...ev.map((e) => e.date)].sort());
  const find = (t) => ev.find((e) => e.title === t);
  assert.ok(find("Annular solar eclipse").date.startsWith("2027-02-06"));
  assert.ok(find("Jupiter at opposition").date.startsWith("2027-02-1"));
});
