// Sun and moon positions, computed locally from latitude and longitude.
//
// The formulas are the ones popularized by Vladimir Agafonkin's SunCalc
// (after "Astronomy Answers" by Aphelion): accurate to about a minute for
// sunrise and sunset, which is all a wall display needs, and small enough
// that the module has nothing to fetch.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
/** Obliquity of the Earth's axis. */
const OBLIQUITY = RAD * 23.4397;
/** Sun altitude at sunrise/sunset: refraction plus the sun's own radius. */
const HORIZON = RAD * -0.833;
const J0 = 0.0009;
const SUN_DISTANCE_KM = 149598000;

const toJulian = (ms: number) => ms / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;
const toDays = (ms: number) => toJulian(ms) - J2000;

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(m: number): number {
  const center = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const perihelion = RAD * 102.9372;
  return m + center + perihelion + Math.PI;
}

function sunCoords(d: number) {
  const l = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(l, 0), ra: rightAscension(l, 0) };
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

export interface SunTimes {
  /** Epoch ms; null when the sun doesn't rise or set that day. */
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number;
  /** Set only on days the sun never crosses the horizon. */
  polar?: 'day' | 'night';
}

/** Sunrise, sunset and solar noon for the day whose solar transit is nearest
 *  `ms`. Pass a moment near local noon to get that calendar day. */
export function sunTimes(ms: number, lat: number, lng: number): SunTimes {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const n = Math.round(toDays(ms) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const solarNoon = fromJulian(jNoon);

  const cosH = (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1) return { sunrise: null, sunset: null, solarNoon, polar: 'day' };
  if (cosH > 1) return { sunrise: null, sunset: null, solarNoon, polar: 'night' };

  const w = Math.acos(cosH);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const jSet = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet), solarNoon };
}

export interface MoonPhase {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Illuminated fraction of the disc, 0..1. */
  fraction: number;
}

export function moonPhase(ms: number): MoonPhase {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec)
    + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(SUN_DISTANCE_KM * Math.sin(phi), m.dist - SUN_DISTANCE_KM * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return {
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
    fraction: (1 + Math.cos(inc)) / 2,
  };
}

const PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

export function moonPhaseName(phase: number): string {
  return PHASE_NAMES[Math.round(phase * 8) % 8];
}

// ── Time of day ─────────────────────────────────────────────────────────────

/** The calendar date `ms` falls on in `timezone`, as [year, month 1-12, day]. */
export function localDate(ms: number, timezone?: string): [number, number, number] {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, year: 'numeric', month: 'numeric', day: 'numeric' });
  } catch {
    f = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  }
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) v[p.type] = Number(p.value);
  return [v.year, v.month, v.day];
}

/** Today's sun times for the household's calendar day, not the one nearest
 *  in solar time: just after midnight the nearest noon can be yesterday's. */
export function todaysSunTimes(now: number, lat: number, lng: number, timezone?: string): SunTimes {
  const [y, m, d] = localDate(now, timezone);
  // Noon UTC shifted by longitude lands near this place's own solar noon.
  const localNoon = Date.UTC(y, m - 1, d, 12) - (lng / 15) * 3_600_000;
  return sunTimes(localNoon, lat, lng);
}

export type DayPhase = 'rising' | 'day' | 'setting' | 'night';

/** Which icon belongs at `now`: the rising or setting sun within `windowMs`
 *  either side of sunrise or sunset, the full sun between them, the moon
 *  otherwise. */
export function dayPhase(now: number, t: SunTimes, windowMs: number): DayPhase {
  if (t.polar) return t.polar === 'day' ? 'day' : 'night';
  if (t.sunrise == null || t.sunset == null) return 'night';
  const toRise = Math.abs(now - t.sunrise);
  const toSet = Math.abs(now - t.sunset);
  if (toRise <= windowMs || toSet <= windowMs) return toRise <= toSet ? 'rising' : 'setting';
  return now > t.sunrise && now < t.sunset ? 'day' : 'night';
}

/** How far the sun is through its day, 0 at sunrise to 1 at sunset; null
 *  while it is down. */
export function dayProgress(now: number, t: SunTimes): number | null {
  if (t.polar === 'day') {
    // No horizon crossing: run the arc from midnight to midnight around noon.
    return Math.min(1, Math.max(0, 0.5 + (now - t.solarNoon) / DAY_MS));
  }
  if (t.sunrise == null || t.sunset == null) return null;
  if (now < t.sunrise || now > t.sunset) return null;
  return (now - t.sunrise) / (t.sunset - t.sunrise);
}
