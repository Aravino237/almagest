// Computed sky events for a date range: Moon quarters, eclipses, planetary
// oppositions and greatest elongations (astronomy-engine), plus major annual meteor
// showers (approximate peak dates from the IMO calendar; they shift by about a day year to year).
const { A } = require("./sky");

const SHOWERS = [
  ["Quadrantids", 1, 3, 110], ["Lyrids", 4, 22, 18], ["Eta Aquariids", 5, 6, 50], ["Perseids", 8, 12, 100],
  ["Orionids", 10, 21, 20], ["Leonids", 11, 17, 15], ["Geminids", 12, 14, 150],
];
const QUARTER = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];

function computeEvents(from, days) {
  const to = new Date(from.getTime() + days * 864e5);
  const out = [];
  const push = (date, kind, title, detail) => { if (date >= from && date <= to) out.push({ date: date.toISOString(), kind, title, detail }); };

  let mq = A.SearchMoonQuarter(A.MakeTime(from));
  while (mq.time.date <= to) { push(mq.time.date, "moon", QUARTER[mq.quarter], mq.quarter === 0 ? "Darkest skies of the month for deep-sky targets" : mq.quarter === 2 ? "Bright Moon: good for lunar and planetary viewing" : ""); mq = A.NextMoonQuarter(mq); }

  let le = A.SearchLunarEclipse(A.MakeTime(from));
  while (le.peak.date <= to) { push(le.peak.date, "eclipse", `${cap(le.kind)} lunar eclipse`, `Visible wherever the Moon is up at ${le.peak.date.toISOString().slice(11, 16)} UTC`); le = A.NextLunarEclipse(le.peak); }
  let se = A.SearchGlobalSolarEclipse(A.MakeTime(from));
  while (se.peak.date <= to) { push(se.peak.date, "eclipse", `${cap(se.kind)} solar eclipse`, se.latitude !== undefined ? `Greatest eclipse near ${se.latitude.toFixed(1)}°, ${se.longitude.toFixed(1)}°. Never look without a certified solar filter.` : "Never look without a certified solar filter."); se = A.NextGlobalSolarEclipse(se.peak); }

  for (const b of ["Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]) {
    const t = A.SearchRelativeLongitude(A.Body[b], 0, A.MakeTime(from)) // 0° relative heliocentric longitude = opposition;
    if (t) push(t.date, "planet", `${b} at opposition`, `${b} is closest and brightest, visible all night`);
  }
  for (const b of ["Mercury", "Venus"]) {
    let e = A.SearchMaxElongation(A.Body[b], A.MakeTime(from));
    for (let i = 0; i < 4 && e.time.date <= to; i++) {
      push(e.time.date, "planet", `${b} at greatest ${e.visibility === "morning" ? "western" : "eastern"} elongation`,
        `${e.elongation.toFixed(1)}° from the Sun, best seen in the ${e.visibility} sky`);
      e = A.SearchMaxElongation(A.Body[b], e.time.AddDays(1));
    }
  }
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++)
    for (const [name, m, d, zhr] of SHOWERS)
      push(new Date(Date.UTC(y, m - 1, d, 0)), "meteor", `${name} peak (approx.)`, `Up to ~${zhr} meteors/hour under ideal dark skies`);

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
module.exports = { computeEvents };
