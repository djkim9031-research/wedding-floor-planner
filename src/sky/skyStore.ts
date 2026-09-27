import { horizonAltDeg, moonState, phaseName, sunDirModel, sunPosition } from '../scene/sun';
import { cctToLinear } from './exposure';
import type { EquirectImage, SkyInput, SkyPhase, SkyState, Vec3 } from './types';

/** Showcase preset: a clear mid-October late afternoon. */
export const SHOWCASE_INPUT: SkyInput = {
  enabled: false,
  date: '2026-10-11',
  minutes: 16 * 60 + 30,
  cloudPct: 0,
  evComp: 0,
  autoEV: false,
};

type SkyModel = (input: SkyInput, base: Omit<SkyState, 'env' | 'bg' | 'skyHorizontalLux' | 'ev100' | 'version'>) => {
  env: EquirectImage;
  bg: EquirectImage;
  skyHorizontalLux: number;
  ev100: number;
};

let model: SkyModel = gradientSky;
let input: SkyInput = { ...SHOWCASE_INPUT, enabled: true };
let state: SkyState | null = null;
let version = 0;
const subs = new Set<(s: SkyState) => void>();

/** Swap the sky model (the physical atmosphere registers itself here). */
export function setSkyModel(m: SkyModel): void {
  model = m;
  state = null;
  emit();
}

export function getSky(): SkyState {
  if (!state) state = compute(input);
  return state;
}

export function getSkyInput(): SkyInput {
  return input;
}

export function setSkyInput(patch: Partial<SkyInput>): void {
  input = { ...input, ...patch };
  state = null;
  emit();
}

export function subscribeSky(fn: (s: SkyState) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emit(): void {
  if (!subs.size) return;
  const s = getSky();
  for (const fn of subs) fn(s);
}

function phaseOf(alt: number): SkyPhase {
  const p = phaseName(alt);
  return p === 'day' ? 'day' : p.startsWith('civil') ? 'civil' : p.startsWith('nautical') ? 'nautical' : p.startsWith('astro') ? 'astronomical' : 'night';
}

function compute(raw: SkyInput): SkyState {
  const inp = raw.enabled ? raw : { ...SHOWCASE_INPUT, evComp: raw.evComp, autoEV: raw.autoEV };
  const sun = sunPosition(inp.date, inp.minutes);
  const moon = moonState(inp.date, inp.minutes);
  const d = sunDirModel(sun);
  const md = sunDirModel({ altitudeDeg: moon.altitudeDeg, azimuthDeg: moon.azimuthDeg, azimuthModelDeg: moon.azimuthModelDeg });
  // the western ridge swallows the disc ~2° early; fade across the disc
  const ridge = horizonAltDeg(sun.azimuthDeg);
  const over = sun.altitudeDeg - ridge;
  const ridgeVisibility = Math.min(Math.max((over + 0.27) / 0.54, 0), 1);
  const clouds = inp.cloudPct / 100;
  const alt = sun.altitudeDeg;
  // clear-sky direct normal illuminance with a simple air-mass law
  // (Kasten–Young); the physical atmosphere model replaces all of this
  const am = alt > -0.5 ? 1 / (Math.sin(Math.max(alt, 0.1) * (Math.PI / 180)) + 0.50572 * Math.pow(Math.max(alt, 0) + 6.07995, -1.6364)) : 40;
  const dni = alt > -0.5 ? 128000 * Math.pow(0.7, Math.pow(am, 0.678)) : 0;
  const warmth = Math.min(Math.max(alt / 25, 0), 1);
  const colorLinear = cctToLinear(2200 + 3600 * warmth) as Vec3;
  const base = {
    input: raw,
    phase: phaseOf(alt),
    sun: {
      altDeg: alt,
      azTrueDeg: sun.azimuthDeg,
      azModelDeg: sun.azimuthModelDeg,
      dir: [d.x, d.y, d.z] as Vec3,
      ridgeVisibility,
      illuminanceLux: dni * ridgeVisibility * (1 - 0.9 * clouds),
      colorLinear,
      angularDiameterDeg: 0.545,
    },
    moon: {
      altDeg: moon.altitudeDeg,
      azModelDeg: moon.azimuthModelDeg,
      dir: [md.x, md.y, md.z] as Vec3,
      fraction: moon.fraction,
      brightLimbDeg: moon.brightLimbDeg,
      illuminanceLux: moon.altitudeDeg > 0 ? 0.25 * Math.pow(moon.fraction, 1.5) * Math.sin((moon.altitudeDeg * Math.PI) / 180) * (1 - 0.9 * clouds) : 0,
      colorLinear: [0.92, 0.95, 1] as Vec3,
    },
  };
  const m = model(inp, base);
  return { ...base, ...m, version: ++version };
}

/** Placeholder analytic sky (vertical gradient scaled by sun altitude) so the
 * pipelines can run before the physical atmosphere lands. */
function gradientSky(inp: SkyInput, base: Parameters<SkyModel>[1]): ReturnType<SkyModel> {
  const alt = base.sun.altDeg;
  const day = Math.min(Math.max((alt + 6) / 30, 0), 1);
  const zenith = 50 + 6000 * day * day; // cd/m²
  const w = 256;
  const h = 128;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const el = ((y + 0.5) / h - 0.5) * Math.PI; // −π/2 .. π/2
    const up = Math.max(Math.sin(el), 0);
    const horizonBoost = 1.6 - 0.9 * up;
    const L = el < 0 ? zenith * 0.25 : zenith * horizonBoost;
    const blue = el < 0 ? [0.55, 0.5, 0.42] : [0.55 + 0.35 * (1 - up), 0.7 + 0.2 * (1 - up), 1];
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = L * blue[0];
      data[o + 1] = L * blue[1];
      data[o + 2] = L * blue[2];
      data[o + 3] = 1;
    }
  }
  const env = { w, h, data };
  const skyHorizontalLux = Math.PI * zenith * 1.2;
  const ev100 = Math.log2(((skyHorizontalLux + base.sun.illuminanceLux * Math.max(Math.sin((alt * Math.PI) / 180), 0)) * 0.18 * 100) / (Math.PI * 12.5)) - inp.evComp;
  return { env, bg: env, skyHorizontalLux, ev100 };
}
