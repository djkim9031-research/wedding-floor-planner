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

/** Sunrise/sunset in venue-local minutes: −0.833° refraction horizon plus the
 * horizon dip from the site's 119 m elevation (≈0.32° — a couple of minutes
 * of extra sun at each end of the day). */
export function sunTimes(dateStr: string): { sunrise: number | null; sunset: number | null } {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const tzMin = tzOffsetMinutes(dateStr);
  const doy = dayOfYear(y, mo, d);
  const { eqtime, decl } = solarBasics(doy, 12 - tzMin / 60);
  const lat = VENUE.lat * RAD;
  const dip = 0.0293 * Math.sqrt(VENUE.elevM);
  const cosH0 =
    Math.cos((90.833 + dip) * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosH0 < -1 || cosH0 > 1) return { sunrise: null, sunset: null };
  const ha0 = Math.acos(cosH0) / RAD;
  return {
    sunrise: 720 - 4 * (VENUE.lon + ha0) - eqtime + tzMin,
    sunset: 720 - 4 * (VENUE.lon - ha0) - eqtime + tzMin,
  };
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
