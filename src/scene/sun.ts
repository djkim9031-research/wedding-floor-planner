/**
 * Solar position for the venue, NOAA general algorithm (accuracy ~±0.2°,
 * plenty for lighting). All local times are venue-local (America/Los_Angeles,
 * DST-aware via Intl); minutes are minutes-after-midnight.
 */

export const VENUE = {
  lat: 37.42, // the venue, SF peninsula (rounded ~1 km; sun error < 0.01°)
  lon: -122.2,
  elevM: 119, // 390 ft above sea level
  tz: 'America/Los_Angeles',
};

/** The deck glass wall (model −z) faces true azimuth 50° (NE). */
export const FACADE_AZ_DEG = 50;

export interface SunState {
  altitudeDeg: number;
  /** true azimuth, 0 = north, clockwise */
  azimuthDeg: number;
  /** azimuth rotated into the model frame (0 = model −z, i.e. the deck side) */
  azimuthModelDeg: number;
}

const RAD = Math.PI / 180;

export function tzOffsetMinutes(dateStr: string): number {
  try {
    const dt = new Date(`${dateStr}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: VENUE.tz, timeZoneName: 'shortOffset' });
    const part = fmt.formatToParts(dt).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-8';
    const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return -480;
    const h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + Math.sign(h) * mm;
  } catch {
    return -480;
  }
}

function dayOfYear(y: number, mo: number, d: number): number {
  return Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

function solarBasics(doy: number, hourUtc: number): { eqtime: number; decl: number } {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourUtc - 12) / 24);
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { eqtime, decl };
}

export function sunPosition(dateStr: string, minutesLocal: number): SunState {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const tzMin = tzOffsetMinutes(dateStr);
  const hourUtc = (minutesLocal - tzMin) / 60;
  const doy = dayOfYear(y, mo, d);
  const { eqtime } = solarBasics(doy, hourUtc);
  const { decl } = solarBasics(doy, hourUtc);
  const tst = minutesLocal + eqtime + 4 * VENUE.lon - tzMin;
  const ha = (tst / 4 - 180) * RAD;
  const lat = VENUE.lat * RAD;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen)));
  const altitudeDeg = 90 - zen / RAD;
  const sinZen = Math.sin(zen);
  let azimuthDeg = 180;
  if (sinZen > 1e-6) {
    const sinAz = (-Math.sin(ha) * Math.cos(decl)) / sinZen;
    const cosAz = (Math.sin(decl) - Math.sin(lat) * cosZen) / (Math.cos(lat) * sinZen);
    azimuthDeg = (Math.atan2(sinAz, cosAz) / RAD + 360) % 360;
  }
  return {
    altitudeDeg,
    azimuthDeg,
    azimuthModelDeg: (azimuthDeg - FACADE_AZ_DEG + 360) % 360,
  };
}

/** Crossing times for a given solar zenith angle, venue-local minutes. */
function crossingTimes(
  dateStr: string,
  zenithDeg: number,
): { rise: number | null; set: number | null } {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const tzMin = tzOffsetMinutes(dateStr);
  const doy = dayOfYear(y, mo, d);
  const { eqtime, decl } = solarBasics(doy, 12 - tzMin / 60);
  const lat = VENUE.lat * RAD;
  const cosH0 = Math.cos(zenithDeg * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosH0 < -1 || cosH0 > 1) return { rise: null, set: null };
  const ha0 = Math.acos(cosH0) / RAD;
  return {
    rise: 720 - 4 * (VENUE.lon + ha0) - eqtime + tzMin,
    set: 720 - 4 * (VENUE.lon - ha0) - eqtime + tzMin,
  };
}

/** Sunrise/sunset (standard −0.833° almanac horizon, matching published
 * tables; the site's 119 m elevation is deliberately NOT applied here). */
export function sunTimes(dateStr: string): { sunrise: number | null; sunset: number | null } {
  const t = crossingTimes(dateStr, 90.833);
  return { sunrise: t.rise, sunset: t.set };
}

/** Twilight boundaries: civil (−6°), nautical (−12°), astronomical (−18°). */
export function twilightTimes(dateStr: string): {
  civilDawn: number | null;
  civilDusk: number | null;
  nauticalDusk: number | null;
  astroDusk: number | null;
} {
  const civil = crossingTimes(dateStr, 96);
  const naut = crossingTimes(dateStr, 102);
  const astro = crossingTimes(dateStr, 108);
  return { civilDawn: civil.rise, civilDusk: civil.set, nauticalDusk: naut.set, astroDusk: astro.set };
}

/** Apparent elevation of the Santa Cruz ridge to the west (~2°): the sun
 * drops behind it ≈10 minutes before the almanac sunset (calibrated against
 * the observed Oct 11 disappearance). Feathered across the WSW–NW arc. */
export function horizonAltDeg(azTrueDeg: number): number {
  const az = ((azTrueDeg % 360) + 360) % 360;
  const rise = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  return 2.0 * rise(215, 240, az) * (1 - rise(300, 325, az));
}

/** Minute the sun actually vanishes behind the western ridge. */
export function hillSetTime(dateStr: string): number | null {
  const t = sunTimes(dateStr).sunset;
  if (t === null) return null;
  let last: number | null = null;
  for (let m = Math.round(t) - 75; m <= Math.round(t) + 5; m++) {
    const p = sunPosition(dateStr, m);
    if (p.altitudeDeg - horizonAltDeg(p.azimuthDeg) >= -0.833) last = m;
  }
  return last;
}

/** Twilight phase name for an altitude. */
export function phaseName(altitudeDeg: number): string {
  if (altitudeDeg >= 0) return 'day';
  if (altitudeDeg >= -6) return 'civil twilight';
  if (altitudeDeg >= -12) return 'nautical twilight';
  if (altitudeDeg >= -18) return 'astronomical twilight';
  return 'night';
}

/** Unit vector pointing FROM the scene TOWARD the sun, model frame. */
export function sunDirModel(s: SunState): { x: number; y: number; z: number } {
  const a = s.azimuthModelDeg * RAD;
  const h = s.altitudeDeg * RAD;
  return { x: Math.sin(a) * Math.cos(h), y: Math.sin(h), z: -Math.cos(a) * Math.cos(h) };
}

export function fmtClock(min: number | null): string {
  if (min === null) return '—';
  let m = Math.round(min);
  m = ((m % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Moon — truncated lunar ephemeris (±0.3°, ample for sky rendering) + phase.
// ---------------------------------------------------------------------------

export interface MoonState {
  altitudeDeg: number;
  azimuthDeg: number;
  azimuthModelDeg: number;
  /** illuminated fraction 0..1 */
  fraction: number;
  waxing: boolean;
  /** position angle of the bright limb vs the local zenith direction (deg) */
  brightLimbDeg: number;
  phaseLabel: string;
  emoji: string;
}

/** Days since J2000.0 (UT) for a venue-local date + minutes. */
function j2000Days(dateStr: string, minutesLocal: number): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const tzMin = tzOffsetMinutes(dateStr);
  const utcMs = Date.UTC(y, mo - 1, d) + (minutesLocal - tzMin) * 60000;
  return (utcMs - Date.UTC(2000, 0, 1, 12)) / 86400000;
}

/** Sun's ecliptic longitude (rad) — for the phase geometry. */
function sunEclipticLon(dDays: number): number {
  const g = (357.529 + 0.98560028 * dDays) * RAD;
  return ((280.459 + 0.98564736 * dDays) % 360) * RAD + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
}

const PHASES: { label: string; emoji: string }[] = [
  { label: 'new moon', emoji: '🌑' },
  { label: 'waxing crescent', emoji: '🌒' },
  { label: 'first quarter', emoji: '🌓' },
  { label: 'waxing gibbous', emoji: '🌔' },
  { label: 'full moon', emoji: '🌕' },
  { label: 'waning gibbous', emoji: '🌖' },
  { label: 'last quarter', emoji: '🌗' },
  { label: 'waning crescent', emoji: '🌘' },
];

export function moonState(dateStr: string, minutesLocal: number): MoonState {
  const dDays = j2000Days(dateStr, minutesLocal);
  const L = 218.316 + 13.176396 * dDays; // mean longitude
  const M = (134.963 + 13.064993 * dDays) * RAD; // mean anomaly
  const F = (93.272 + 13.22935 * dDays) * RAD; // argument of latitude
  const lam = (L % 360) * RAD + 6.289 * RAD * Math.sin(M);
  const beta = 5.128 * RAD * Math.sin(F);
  const eps = (23.4393 - 3.563e-7 * dDays) * RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(
    Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam),
  );
  const gmst = 280.16 + 360.9856235 * dDays;
  const H = ((gmst + VENUE.lon) % 360) * RAD - ra; // hour angle
  const lat = VENUE.lat * RAD;
  const alt = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H),
  );
  const azFromSouth = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
  );
  const azimuthDeg = ((azFromSouth / RAD + 180) % 360 + 360) % 360;

  // phase from the sun–moon elongation in ecliptic longitude
  const elong = lam - sunEclipticLon(dDays);
  const fraction = (1 - Math.cos(elong)) / 2;
  const waxing = Math.sin(elong) > 0;
  const elongDeg = ((elong / RAD) % 360 + 360) % 360;
  const phase = PHASES[Math.round(elongDeg / 45) % 8];

  // bright limb direction on the visible disc, measured from local "up"
  const sun = sunPosition(dateStr, minutesLocal);
  const dAz = (sun.azimuthDeg - azimuthDeg) * RAD;
  const hs = sun.altitudeDeg * RAD;
  const chi = Math.atan2(
    Math.cos(hs) * Math.sin(dAz),
    Math.sin(hs) * Math.cos(alt) - Math.cos(hs) * Math.sin(alt) * Math.cos(dAz),
  );

  return {
    altitudeDeg: alt / RAD,
    azimuthDeg,
    azimuthModelDeg: (azimuthDeg - FACADE_AZ_DEG + 360) % 360,
    fraction,
    waxing,
    brightLimbDeg: chi / RAD,
    phaseLabel: phase.label,
    emoji: phase.emoji,
  };
}

/** Moonrise / moonset (upper-limb ≈ +0.125° with parallax), local minutes. */
export function moonTimes(dateStr: string): { rise: number | null; set: number | null } {
  const H0 = 0.125;
  let rise: number | null = null;
  let set: number | null = null;
  let prev = moonState(dateStr, 0).altitudeDeg;
  for (let m = 6; m < 1440; m += 6) {
    const a = moonState(dateStr, m).altitudeDeg;
    if (prev < H0 && a >= H0 && rise === null) rise = m - 6 * ((a - H0) / (a - prev));
    if (prev >= H0 && a < H0 && set === null) set = m - 6 * ((a - H0) / (a - prev));
    prev = a;
  }
  return { rise, set };
}
