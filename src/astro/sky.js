// Astronomy layer: thin, tested wrappers around astronomy-engine (Cross, MIT licence),
// which implements VSOP87 planets, ELP lunar theory, precession and nutation.
// Fixed objects are stored at J2000 and precessed to the date of observation.
const A = require("astronomy-engine");

const BODY = { mercury: A.Body.Mercury, venus: A.Body.Venus, mars: A.Body.Mars, jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune };

// Naked-eye limiting magnitude at zenith for each Bortle class (after Bortle 2001, midpoints).
const NELM = { 1: 7.6, 2: 7.2, 3: 6.8, 4: 6.3, 5: 5.8, 6: 5.5, 7: 5.0, 8: 4.5, 9: 4.0 };

function limitingMagnitude(bortle, apertureMm) {
  const nelm = NELM[bortle] ?? 5.5;
  if (!apertureMm) return nelm;
  // Light-grasp gain over a ~7 mm dark-adapted pupil: 5·log10(D/7).
  return Math.min(16, nelm + 5 * Math.log10(apertureMm / 7));
}

function j2000ToDate(raHours, decDeg, time) {
  const v = A.VectorFromSphere(new A.Spherical(decDeg, raHours * 15, 1), time);
  return A.EquatorFromVector(A.RotateVector(A.Rotation_EQJ_EQD(time), v));
}

// Add standard atmospheric refraction, but only near and above the horizon,
// where it is physically meaningful (it lifts objects ~0.5° at the horizon).
function apparent(geometricAlt) {
  return geometricAlt > -1 ? geometricAlt + A.Refraction("normal", geometricAlt) : geometricAlt;
}

// Position of a catalog object for an observer at a moment.
function position(obj, date, lat, lon) {
  const time = A.MakeTime(date);
  const obs = new A.Observer(lat, lon, 0);
  let eq, mag = obj.magnitude;
  if (obj.type === "planet") {
    const body = BODY[obj.slug];
    eq = A.Equator(body, time, obs, true, true);
    mag = A.Illumination(body, time).mag;
  } else {
    eq = j2000ToDate(obj.ra_hours, obj.dec_deg, time);
  }
  const hor = A.Horizon(time, obs, eq.ra, eq.dec, null);
  return { alt: apparent(hor.altitude), az: hor.azimuth, ra: eq.ra, dec: eq.dec, mag };
}

function sunAltitude(date, lat, lon) {
  const time = A.MakeTime(date), obs = new A.Observer(lat, lon, 0);
  const eq = A.Equator(A.Body.Sun, time, obs, true, true);
  return A.Horizon(time, obs, eq.ra, eq.dec, null).altitude; // geometric: twilight is defined without refraction
}

const PHASES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
// Named phase from the Sun-Moon angle: quarters and new/full are +-5 degree windows; the rest are crescents/gibbous.
function phaseName(a) {
  if (a < 5 || a >= 355) return PHASES[0];
  if (a < 85) return PHASES[1];
  if (a < 95) return PHASES[2];
  if (a < 175) return PHASES[3];
  if (a < 185) return PHASES[4];
  if (a < 265) return PHASES[5];
  if (a < 275) return PHASES[6];
  return PHASES[7];
}
function moon(date, lat, lon) {
  const time = A.MakeTime(date), obs = new A.Observer(lat, lon, 0);
  const eq = A.Equator(A.Body.Moon, time, obs, true, true);
  const hor = A.Horizon(time, obs, eq.ra, eq.dec, null);
  const angle = A.MoonPhase(time); // 0 new, 90 first quarter, 180 full, 270 last quarter
  return {
    illumination: A.Illumination(A.Body.Moon, time).phase_fraction,
    phaseAngle: angle,
    phaseName: phaseName(angle),
    alt: apparent(hor.altitude), az: hor.azimuth, ra: eq.ra, dec: eq.dec,
  };
}

// Angular separation in degrees between two equatorial positions (RA in hours).
function separation(ra1, dec1, ra2, dec2) {
  const d = Math.PI / 180;
  const c = Math.sin(dec1 * d) * Math.sin(dec2 * d) + Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * 15 * d);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d;
}

// Astronomical darkness (sun below -18°) for the night containing / following `date`.
function darkWindow(date, lat, lon) {
  const obs = new A.Observer(lat, lon, 0);
  const inDark = sunAltitude(date, lat, lon) <= -18;
  const searchFrom = A.MakeTime(new Date(date.getTime() - (inDark ? 16 * 3600e3 : 0)));
  const dusk = A.SearchAltitude(A.Body.Sun, obs, -1, searchFrom, 2, -18);
  const dawn = dusk ? A.SearchAltitude(A.Body.Sun, obs, +1, dusk, 2, -18) : null;
  return { dusk: dusk ? dusk.date : null, dawn: dawn ? dawn.date : null, sunAlt: sunAltitude(date, lat, lon) };
}

// Altitude track for a chart: `hours` hours from `start`, every `stepMin` minutes.
function track(obj, start, hours, stepMin, lat, lon) {
  const pts = [];
  for (let m = 0; m <= hours * 60; m += stepMin) {
    const d = new Date(start.getTime() + m * 60e3);
    pts.push({ t: d.toISOString(), alt: +position(obj, d, lat, lon).alt.toFixed(2), sunAlt: +sunAltitude(d, lat, lon).toFixed(2) });
  }
  return pts;
}

module.exports = { apparent, limitingMagnitude, position, sunAltitude, moon, separation, darkWindow, track, NELM, A };
