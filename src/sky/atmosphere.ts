/**
 * Physically based clear-sky model (Hillaire 2020, "A Scalable and
 * Production Ready Sky and Atmosphere Rendering Technique"), in plain TS so
 * the raster view, the path tracer and the Blender export all light the
 * venue from one sky.
 *
 *   transmittance LUT (256×64, once) ─┐
 *   multiple-scattering LUT (32×32, once) ─┤
 *                                          └► sky-view LUT (per sun elevation,
 *      64 relative azimuths × 64 non-linear elevations, phase factored out)
 *        └► bg 1024×512 (phase evaluated per texel) ─► env 512×256 (2×2 box)
 *
 * Units: luminance cd/m², illuminance lux. The three RGB channels are the
 * linear Rec.709 primaries (Hillaire's coefficients are fit to them), and the
 * top-of-atmosphere sun is white with luminance E0 — i.e. the renders are
 * white-balanced to sunlight above the atmosphere.
 *
 * Geometry: planet-centred, Y up at the observer. Works below the horizon:
 * the sun transmittance is shadowed by the planet (soft across the disc), so
 * twilight shows the Earth's shadow and the Belt of Venus. The sun disc is
 * never drawn into env/bg — it is the DirectionalLight's job.
 */
import { tzOffsetMinutes, VENUE } from '../scene/sun';
import { luminance, meteredEV100, presetEV100 } from './exposure';
import { STAR_CATALOG } from './stars';
import type { EquirectImage, SkyInput, SkyState, Vec3 } from './types';

// ---------------------------------------------------------------------------
// Parameters (km, per km)
// ---------------------------------------------------------------------------

/** Mie multiplier over Hillaire's (very clean) default — the Bay is hazy. */
const HAZE = 8;

export const ATMOSPHERE = {
  groundRadiusKm: 6360,
  topRadiusKm: 6460,
  observerAltKm: VENUE.elevM / 1000,
  rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3] as Vec3,
  rayleighScaleHeightKm: 8,
  mieScattering: 3.996e-3 * HAZE,
  mieAbsorption: 0.444e-3 * HAZE,
  mieScaleHeightKm: 1.2,
  mieG: 0.8,
  ozoneAbsorption: [1.1e-3, 1.881e-3, 0.085e-3] as Vec3,
  ozoneCenterKm: 25,
  ozoneHalfWidthKm: 15,
  groundAlbedo: 0.12,
  /** top-of-atmosphere solar illuminance, lux (tuned: DNI ≈ 105 klux high sun) */
  solarIlluminanceLux: 124000,
  sunAngularRadiusRad: 0.2725 * (Math.PI / 180),
  moonAngularRadiusRad: 0.26 * (Math.PI / 180),
  /** full moon above the atmosphere, lux (mag −12.7) */
  fullMoonLux: 0.267,
  /** Bay Area skyglow at the zenith, cd/m² (≈ 19.5 mag/arcsec², Bortle 7) */
  skyglowZenith: 0.0022,
};

const RG = ATMOSPHERE.groundRadiusKm;
const RT = ATMOSPHERE.topRadiusKm;
const R0 = RG + ATMOSPHERE.observerAltKm;
const H_TOP = Math.sqrt(RT * RT - RG * RG);
const RAY = ATMOSPHERE.rayleighScattering;
const RAY_H = ATMOSPHERE.rayleighScaleHeightKm;
const MIE_S = ATMOSPHERE.mieScattering;
const MIE_T = ATMOSPHERE.mieScattering + ATMOSPHERE.mieAbsorption;
const MIE_H = ATMOSPHERE.mieScaleHeightKm;
const OZ = ATMOSPHERE.ozoneAbsorption;
const OZ_C = ATMOSPHERE.ozoneCenterKm;
const OZ_W = ATMOSPHERE.ozoneHalfWidthKm;
const G = ATMOSPHERE.mieG;
const SUN_R = ATMOSPHERE.sunAngularRadiusRad;
/** astronomical refraction at the horizon from sea level, rad (≈34′) */
const REFR = 0.0099;
/** depression of the geometric horizon seen from the observer */
const DIP = Math.acos(RG / R0);
const PI = Math.PI;
const DEG = PI / 180;

/** bg / env resolution (bg is env upsampled 2×, plus stars and the moon) */
export const BG_W = 1024;
export const BG_H = 512;
export const ENV_W = BG_W / 2;
export const ENV_H = BG_H / 2;

// the sky store's image buffers are recycled every other update
const envPool: Float32Array[] = [];
const bgPool: Float32Array[] = [];
let poolSlot = 0;

// ---------------------------------------------------------------------------
// Transmittance LUT (Bruneton parameterisation, rays that miss the ground)
// ---------------------------------------------------------------------------

const TW = 256;
const TH = 64;
let tLut: Float32Array | null = null;

function buildTransmittance(): Float32Array {
  const lut = new Float32Array(TW * TH * 3);
  const N = 64;
  for (let j = 0; j < TH; j++) {
    const rho = H_TOP * (j / (TH - 1));
    const r = Math.sqrt(rho * rho + RG * RG);
    for (let i = 0; i < TW; i++) {
      const dMin = RT - r;
      const dMax = rho + H_TOP;
      const d = dMin + (i / (TW - 1)) * (dMax - dMin);
      let mu = d === 0 ? 1 : (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d);
      mu = Math.max(-1, Math.min(1, mu));
      let t0 = 0;
      let t1 = 0;
      let t2 = 0;
      const dt = d / N;
      for (let k = 0; k < N; k++) {
        const t = (k + 0.5) * dt;
        const h = Math.sqrt(r * r + t * t + 2 * r * t * mu) - RG;
        const dr = Math.exp(-h / RAY_H);
        const dm = Math.exp(-h / MIE_H) * MIE_T;
        const dO = Math.max(0, 1 - Math.abs(h - OZ_C) / OZ_W);
        t0 += (RAY[0] * dr + dm + OZ[0] * dO) * dt;
        t1 += (RAY[1] * dr + dm + OZ[1] * dO) * dt;
        t2 += (RAY[2] * dr + dm + OZ[2] * dO) * dt;
      }
      const o = (j * TW + i) * 3;
      lut[o] = Math.exp(-t0);
      lut[o + 1] = Math.exp(-t1);
      lut[o + 2] = Math.exp(-t2);
    }
  }
  return lut;
}

/** Transmittance from radius r toward the top of the atmosphere along a ray
 * with zenith cosine mu (which must not hit the ground). */
function transmittanceLut(r: number, mu: number, out: Float64Array): void {
  const lut = tLut!;
  const rho = Math.sqrt(Math.max(r * r - RG * RG, 0));
  const disc = r * r * (mu * mu - 1) + RT * RT;
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
  const dMin = RT - r;
  const dMax = rho + H_TOP;
  const xm = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
  let fx = Math.min(Math.max(xm, 0), 1) * (TW - 1);
  let fy = Math.min(rho / H_TOP, 1) * (TH - 1);
  const x0 = Math.min(fx | 0, TW - 2);
  const y0 = Math.min(fy | 0, TH - 2);
  fx -= x0;
  fy -= y0;
  const a = (y0 * TW + x0) * 3;
  const b = a + 3;
  const c = a + TW * 3;
  const e = c + 3;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = lut[a] * w00 + lut[b] * w10 + lut[c] * w01 + lut[e] * w11;
  out[1] = lut[a + 1] * w00 + lut[b + 1] * w10 + lut[c + 1] * w01 + lut[e + 1] * w11;
  out[2] = lut[a + 2] * w00 + lut[b + 2] * w10 + lut[c + 2] * w01 + lut[e + 2] * w11;
}

/** Sunlight reaching radius r from a sun at zenith cosine mu, including the
 * planet's shadow (soft across the solar disc). */
function sunTransmittance(r: number, muGeo: number, out: Float64Array, airRho = Math.exp(-(r - RG) / RAY_H)): void {
  // Refraction bends grazing sunlight around the planet (≈0.57° one way at
  // the surface, scaling with air density): it keeps the anti-twilight arch
  // lit for longer and lets the observer see the sun until ≈ −0.6°.
  const cosA = Math.sqrt(Math.max(0, 1 - muGeo * muGeo));
  let bend: number;
  let dilution = 1;
  if (muGeo >= 0) {
    // rising ray: one-way refraction, fading with elevation
    bend = REFR * airRho * (0.06 / (0.06 + muGeo));
  } else {
    // descending ray: in through the tangent point and back up to r
    const ht = Math.max(r * cosA - RG, 0);
    const bt = 2 * REFR * Math.exp(-ht / RAY_H);
    bend = bt - REFR * airRho;
    // refractive dilution: neighbouring rays bend by different amounts
    // (dδ/dh = δ/H), so the beam fans out over the path back up to r
    dilution = 1 / (1 + (r * -muGeo * bt) / RAY_H);
  }
  // rotate the direction up by `bend` (≤ 0.02 rad: small-angle sin/cos)
  const b2 = bend * bend;
  const mu = muGeo * (1 - 0.5 * b2) + cosA * bend * (1 - b2 / 6);
  const sinH = RG / r;
  const muHor = -Math.sqrt(Math.max(0, 1 - sinH * sinH));
  // angle of the sun centre above the local geometric horizon (small-angle)
  const above = (mu - muHor) / Math.max(sinH, 1e-3);
  if (above <= -SUN_R) {
    out[0] = out[1] = out[2] = 0;
    return;
  }
  transmittanceLut(r, Math.max(mu, muHor + 1e-5), out);
  let vis = dilution;
  if (above < SUN_R) {
    const t = (above + SUN_R) / (2 * SUN_R);
    vis *= t * t * (3 - 2 * t);
  }
  if (vis < 1) {
    out[0] *= vis;
    out[1] *= vis;
    out[2] *= vis;
  }
}

// ---------------------------------------------------------------------------
// Multiple-scattering LUT (Hillaire §5.5): Ψms(h, μs) for unit illuminance
// ---------------------------------------------------------------------------

const MW = 32;
const MH = 32;
let msLut: Float32Array | null = null;

// Non-linear axes: Ψms falls by orders of magnitude within a few degrees of
// solar depression, so μs is sampled densely around 0 (bins ≈ 0.06°, 0.5°,
// 1.5°, 2.9°, 4.8° … from the horizon) and height densely near the ground.
// Hillaire's linear 32-bin μs axis smears the bright sunset MS into the
// shadowed twilight and washes out the Belt of Venus.
const msMu = (u: number): number => {
  const t = 2 * u - 1;
  return t * Math.abs(t);
};
const msMuInv = (mu: number): number => 0.5 + 0.5 * Math.sign(mu) * Math.sqrt(Math.min(Math.abs(mu), 1));
const msHeight = (v: number): number => (RT - RG) * v * v;
const msHeightInv = (h: number): number => Math.sqrt(Math.min(Math.max(h / (RT - RG), 0), 1));

function buildMultipleScattering(): Float32Array {
  const lut = new Float32Array(MW * MH * 3);
  const albedo = ATMOSPHERE.groundAlbedo;
  const SQ = 8;
  const N = 20;
  const Ts = new Float64Array(3);
  const iso = 1 / (4 * PI);
  // stratified uniform sphere directions
  const dirs: number[] = [];
  for (let a = 0; a < SQ; a++) {
    for (let b = 0; b < SQ; b++) {
      const cz = 1 - (2 * (a + 0.5)) / SQ;
      const sz = Math.sqrt(1 - cz * cz);
      const ph = (2 * PI * (b + 0.5)) / SQ;
      dirs.push(sz * Math.cos(ph), cz, sz * Math.sin(ph));
    }
  }
  for (let j = 0; j < MH; j++) {
    const r = RG + Math.max(0.01, msHeight(j / (MH - 1)) - 0.01);
    for (let i = 0; i < MW; i++) {
      const mus = msMu(i / (MW - 1));
      const sx = Math.sqrt(Math.max(0, 1 - mus * mus));
      const sy = mus;
      let L0 = 0;
      let L1 = 0;
      let L2 = 0;
      let F0 = 0;
      let F1 = 0;
      let F2 = 0;
      for (let k = 0; k < dirs.length; k += 3) {
        const dx = dirs[k];
        const dy = dirs[k + 1];
        const dz = dirs[k + 2];
        const discT = r * r * (dy * dy - 1) + RT * RT;
        const tTop = -r * dy + Math.sqrt(Math.max(discT, 0));
        const discG = r * r * (dy * dy - 1) + RG * RG;
        const hitsGround = dy < 0 && discG > 0;
        const tMax = hitsGround ? -r * dy - Math.sqrt(discG) : tTop;
        let v0 = 1;
        let v1 = 1;
        let v2 = 1;
        const dt = tMax / N;
        for (let s = 0; s < N; s++) {
          const t = (s + 0.5) * dt;
          const px = t * dx;
          const py = r + t * dy;
          const pz = t * dz;
          const rr = Math.sqrt(px * px + py * py + pz * pz);
          const h = rr - RG;
          const dr = Math.exp(-h / RAY_H);
          const dmx = Math.exp(-h / MIE_H);
          const dO = Math.max(0, 1 - Math.abs(h - OZ_C) / OZ_W);
          const ss0 = RAY[0] * dr + MIE_S * dmx;
          const ss1 = RAY[1] * dr + MIE_S * dmx;
          const ss2 = RAY[2] * dr + MIE_S * dmx;
          const st0 = RAY[0] * dr + MIE_T * dmx + OZ[0] * dO;
          const st1 = RAY[1] * dr + MIE_T * dmx + OZ[1] * dO;
          const st2 = RAY[2] * dr + MIE_T * dmx + OZ[2] * dO;
          sunTransmittance(rr, (px * sx + py * sy) / rr, Ts);
          const e0 = Math.exp(-st0 * dt);
          const e1 = Math.exp(-st1 * dt);
          const e2 = Math.exp(-st2 * dt);
          const i0 = (1 - e0) / st0;
          const i1 = (1 - e1) / st1;
          const i2 = (1 - e2) / st2;
          L0 += v0 * ss0 * Ts[0] * iso * i0;
          L1 += v1 * ss1 * Ts[1] * iso * i1;
          L2 += v2 * ss2 * Ts[2] * iso * i2;
          F0 += v0 * ss0 * i0;
          F1 += v1 * ss1 * i1;
          F2 += v2 * ss2 * i2;
          v0 *= e0;
          v1 *= e1;
          v2 *= e2;
        }
        if (hitsGround) {
          const px = tMax * dx;
          const py = r + tMax * dy;
          const pz = tMax * dz;
          const rr = Math.sqrt(px * px + py * py + pz * pz);
          const nl = (px * sx + py * sy) / rr;
          if (nl > 0) {
            sunTransmittance(RG, nl, Ts);
            const k2 = (nl * albedo) / PI;
            L0 += v0 * Ts[0] * k2;
            L1 += v1 * Ts[1] * k2;
            L2 += v2 * Ts[2] * k2;
          }
        }
      }
      const n = dirs.length / 3;
      const o = (j * MW + i) * 3;
      lut[o] = L0 / n / (1 - F0 / n);
      lut[o + 1] = L1 / n / (1 - F1 / n);
      lut[o + 2] = L2 / n / (1 - F2 / n);
    }
  }
  return lut;
}

function msLookup(r: number, mus: number, out: Float64Array): void {
  const lut = msLut!;
  let fx = msMuInv(mus) * (MW - 1);
  let fy = msHeightInv(r - RG) * (MH - 1);
  const x0 = Math.min(fx | 0, MW - 2);
  const y0 = Math.min(fy | 0, MH - 2);
  fx -= x0;
  fy -= y0;
  const a = (y0 * MW + x0) * 3;
  const b = a + 3;
  const c = a + MW * 3;
  const e = c + 3;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = lut[a] * w00 + lut[b] * w10 + lut[c] * w01 + lut[e] * w11;
  out[1] = lut[a + 1] * w00 + lut[b + 1] * w10 + lut[c + 1] * w01 + lut[e + 1] * w11;
  out[2] = lut[a + 2] * w00 + lut[b + 2] * w10 + lut[c + 2] * w01 + lut[e + 2] * w11;
}

let lutMs = 0;
/** Time the one-off LUT build took (ms; 0 until it ran). */
export const lutBuildMs = (): number => lutMs;

/** Build the time-independent LUTs (≈150–400 ms, once). */
export function ensureLuts(): void {
  if (tLut && msLut) return;
  const t0 = now();
  tLut = buildTransmittance();
  msLut = buildMultipleScattering();
  lutMs = now() - t0;
}

// ---------------------------------------------------------------------------
// Sky-view LUT: per (relative azimuth φ ∈ [0, π], elevation e ∈ [0, π/2])
// the in-scattered light with the phase factored out — Rayleigh single,
// Mie single and multiple (isotropic) — so each output texel evaluates the
// phase exactly (sharp aureole from a coarse LUT). 9 floats per entry.
// ---------------------------------------------------------------------------

const NA = 40;
const NE = 48;
const MAX_STEPS = 40;

const rowElev = (j: number): number => (PI / 2) * (j / (NE - 1)) ** 2;
const elevRow = (e: number): number => (NE - 1) * Math.sqrt(Math.min(Math.max(e, 0), PI / 2) / (PI / 2));

// per-row scratch (heights, weights) shared by every azimuth of a row
const rowT = new Float64Array(MAX_STEPS);
const rowPy = new Float64Array(MAX_STEPS);
const rowInvR = new Float64Array(MAX_STEPS);
const rowR = new Float64Array(MAX_STEPS);
const rowAir = new Float64Array(MAX_STEPS);
const rowW = new Float64Array(MAX_STEPS * 9);

function buildSkyView(lightElev: number, out: Float32Array): void {
  const sx = Math.cos(lightElev);
  const sy = Math.sin(lightElev);
  const Ts = new Float64Array(3);
  const Ms = new Float64Array(3);
  const cosPhi = new Float64Array(NA);
  for (let i = 0; i < NA; i++) cosPhi[i] = Math.cos((PI * i) / (NA - 1));
  for (let j = 0; j < NE; j++) {
    const e = rowElev(j);
    const se = Math.sin(e);
    const ce = Math.cos(e);
    const tMax = -R0 * se + Math.sqrt(R0 * R0 * se * se - R0 * R0 + RT * RT);
    const N = Math.min(MAX_STEPS, Math.round(10 + 16 * Math.min(tMax / 600, 1)));
    // everything but the sun geometry is azimuth-independent: heights,
    // densities and the view transmittance depend on (e, t) only
    let v0 = 1;
    let v1 = 1;
    let v2 = 1;
    let tPrev = 0;
    for (let k = 0; k < N; k++) {
      // quadratic step distribution: dense near the observer
      const u = (k + 1) / N;
      const tNext = tMax * u * u;
      const dt = tNext - tPrev;
      const t = 0.5 * (tPrev + tNext);
      tPrev = tNext;
      const py = R0 + t * se;
      const rr = Math.sqrt(t * t * ce * ce + py * py);
      const h = rr - RG;
      const dr = Math.exp(-h / RAY_H);
      const dmx = Math.exp(-h / MIE_H);
      const dO = Math.max(0, 1 - Math.abs(h - OZ_C) / OZ_W);
      const sr0 = RAY[0] * dr;
      const sr1 = RAY[1] * dr;
      const sr2 = RAY[2] * dr;
      const sm = MIE_S * dmx;
      const st0 = sr0 + MIE_T * dmx + OZ[0] * dO;
      const st1 = sr1 + MIE_T * dmx + OZ[1] * dO;
      const st2 = sr2 + MIE_T * dmx + OZ[2] * dO;
      const e0 = Math.exp(-st0 * dt);
      const e1 = Math.exp(-st1 * dt);
      const e2 = Math.exp(-st2 * dt);
      // analytic in-segment integral of the view transmittance
      const w0 = (v0 * (1 - e0)) / st0;
      const w1 = (v1 * (1 - e1)) / st1;
      const w2 = (v2 * (1 - e2)) / st2;
      rowT[k] = t * ce;
      rowPy[k] = py;
      rowR[k] = rr;
      rowAir[k] = dr;
      rowInvR[k] = 1 / rr;
      const o = k * 9;
      rowW[o] = sr0 * w0;
      rowW[o + 1] = sr1 * w1;
      rowW[o + 2] = sr2 * w2;
      rowW[o + 3] = sm * w0;
      rowW[o + 4] = sm * w1;
      rowW[o + 5] = sm * w2;
      rowW[o + 6] = (sr0 + sm) * w0;
      rowW[o + 7] = (sr1 + sm) * w1;
      rowW[o + 8] = (sr2 + sm) * w2;
      v0 *= e0;
      v1 *= e1;
      v2 *= e2;
    }
    for (let i = 0; i < NA; i++) {
      const cp = cosPhi[i] * sx;
      let r0 = 0;
      let r1 = 0;
      let r2 = 0;
      let m0 = 0;
      let m1 = 0;
      let m2 = 0;
      let q0 = 0;
      let q1 = 0;
      let q2 = 0;
      for (let k = 0; k < N; k++) {
        const rr = rowR[k];
        const mus = (rowT[k] * cp + rowPy[k] * sy) * rowInvR[k];
        sunTransmittance(rr, mus, Ts, rowAir[k]);
        msLookup(rr, mus, Ms);
        const o = k * 9;
        r0 += rowW[o] * Ts[0];
        r1 += rowW[o + 1] * Ts[1];
        r2 += rowW[o + 2] * Ts[2];
        m0 += rowW[o + 3] * Ts[0];
        m1 += rowW[o + 4] * Ts[1];
        m2 += rowW[o + 5] * Ts[2];
        q0 += rowW[o + 6] * Ms[0];
        q1 += rowW[o + 7] * Ms[1];
        q2 += rowW[o + 8] * Ms[2];
      }
      const o = (j * NA + i) * 9;
      out[o] = r0;
      out[o + 1] = r1;
      out[o + 2] = r2;
      out[o + 3] = m0;
      out[o + 4] = m1;
      out[o + 5] = m2;
      out[o + 6] = q0;
      out[o + 7] = q1;
      out[o + 8] = q2;
    }
  }
}

interface SkyViewCache {
  elev: number;
  lut: Float32Array;
}
const svSun: SkyViewCache = { elev: NaN, lut: new Float32Array(NA * NE * 9) };
const svMoon: SkyViewCache = { elev: NaN, lut: new Float32Array(NA * NE * 9) };

function skyView(cache: SkyViewCache, elev: number): Float32Array {
  // the LUT only depends on the light's elevation; reuse within 0.005°
  if (!(Math.abs(cache.elev - elev) < 0.005 * DEG)) {
    buildSkyView(elev, cache.lut);
    cache.elev = elev;
  }
  return cache.lut;
}

// ---------------------------------------------------------------------------
// Phase functions
// ---------------------------------------------------------------------------

const K_R = 3 / (16 * PI);
const K_M = (3 / (8 * PI)) * ((1 - G * G) / (2 + G * G));

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

const scratch = new Float64Array(3);

/** Direct-beam transmittance at the observer for a body at altitude altDeg
 * (planet shadow included — 0 once the disc is below the geometric horizon). */
export function transmittanceAt(altDeg: number): Vec3 {
  ensureLuts();
  sunTransmittance(R0, Math.sin(altDeg * DEG), scratch);
  return [scratch[0], scratch[1], scratch[2]];
}

/** Moon illuminance above the atmosphere for an illuminated fraction
 * (Allen's phase law, incl. the opposition surge), lux. */
export function moonIlluminanceTOA(fraction: number): number {
  const alpha = Math.acos(Math.min(1, Math.max(-1, 2 * fraction - 1))) / DEG;
  return ATMOSPHERE.fullMoonLux * 10 ** (-0.4 * (0.026 * alpha + 4e-9 * alpha ** 4));
}

// ---------------------------------------------------------------------------
// Sky synthesis
// ---------------------------------------------------------------------------

export interface SkyRequest {
  /** unit vector toward the sun, three model frame (true altitude) */
  sunDir: Vec3;
  moonDir?: Vec3;
  moonFraction?: number;
  /** position angle of the moon's bright limb from local up, deg (clockwise as seen) */
  moonBrightLimbDeg?: number;
  cloudPct?: number;
  /** 0..1 multiplier on the direct sun (the western ridge), default 1 */
  ridgeVisibility?: number;
  /** venue-local date/minutes — orients the star field; omit for no stars */
  date?: string;
  minutes?: number;
  /** skip the bg image (tests / exporters that only need env) */
  envOnly?: boolean;
  /** reuse the store's double-buffered images (only the sky store sets
   * this; direct callers get fresh arrays they can keep) */
  recycle?: boolean;
}

export interface SkyResult {
  env: EquirectImage;
  bg: EquirectImage | null;
  /** horizontal illuminance from the sky dome (env upper hemisphere), lux */
  skyHorizontalLux: number;
  skyHorizontalRgb: Vec3;
  sun: { illuminanceLux: number; colorLinear: Vec3; transmittance: Vec3 };
  moon: { illuminanceLux: number; colorLinear: Vec3 };
  /** horizontal illuminance, sky + direct sun + moon, lux */
  globalHorizontalLux: number;
  timings: { luts: number; skyView: number; fill: number; bg: number; total: number };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const MOON_TINT: Vec3 = [1.0, 0.94, 0.84];
const GROUND_TINT: Vec3 = [1.0, 1.03, 0.82]; // dry grass / oak woodland, mean ≈ albedo

/** Three-wavelength atmospheres over-saturate compared with integrating the
 * broad sRGB bands (twilight turns purple, the low sun blood-red). A
 * luminance-preserving pull toward grey stands in for the band integral. */
const BROADBAND_DESAT = 0.2;
function desat(c: Vec3): Vec3 {
  const y = luminance(c);
  const k = 1 - BROADBAND_DESAT;
  return [Math.max(0, y + (c[0] - y) * k), Math.max(0, y + (c[1] - y) * k), Math.max(0, y + (c[2] - y) * k)];
}
function normMax(c: Vec3): Vec3 {
  const m = Math.max(c[0], c[1], c[2], 1e-12);
  return [c[0] / m, c[1] / m, c[2] / m];
}
const SKYGLOW_TINT: Vec3 = [1.0, 0.8, 0.58]; // sodium + LED city glow

interface LightRow {
  lut: Float32Array;
  colI: Int32Array;
  colF: Float32Array;
  cosPhi: Float32Array;
  sinL: number;
  cosL: number;
  /** per-channel scale (illuminance × tint) */
  s: [number, number, number];
}

const rowBuf = new Float32Array(NA * 9);

/** Add one light's sky-view contribution to an image row: the two LUT rows
 * are pre-blended once, then each texel lerps two columns and applies the
 * exact phase functions for its scattering angle. */
function addLightRow(img: Float32Array, base: number, W: number, e: number, se: number, ce: number, L: LightRow): void {
  const { lut, colI, colF, cosPhi, sinL, cosL } = L;
  let jf = elevRow(e);
  const j0 = Math.min(jf | 0, NE - 2);
  jf -= j0;
  const A = j0 * NA * 9;
  const B = A + NA * 9;
  const jg = 1 - jf;
  for (let k = 0; k < NA * 9; k++) rowBuf[k] = lut[A + k] * jg + lut[B + k] * jf;
  const s0 = L.s[0];
  const s1 = L.s[1];
  const s2 = L.s[2];
  const a = se * sinL;
  const b = ce * cosL;
  for (let x = 0; x < W; x++) {
    const i = colI[x] * 9;
    const f = colF[x];
    const g = 1 - f;
    const ct = a + b * cosPhi[x];
    const ct2 = 1 + ct * ct;
    const pr = K_R * ct2;
    const den = 1 + G * G - 2 * G * ct;
    const pm = (K_M * ct2) / (den * Math.sqrt(den));
    const o = base + x * 4;
    img[o] += ((rowBuf[i] * g + rowBuf[i + 9] * f) * pr + (rowBuf[i + 3] * g + rowBuf[i + 12] * f) * pm + (rowBuf[i + 6] * g + rowBuf[i + 15] * f)) * s0;
    img[o + 1] += ((rowBuf[i + 1] * g + rowBuf[i + 10] * f) * pr + (rowBuf[i + 4] * g + rowBuf[i + 13] * f) * pm + (rowBuf[i + 7] * g + rowBuf[i + 16] * f)) * s1;
    img[o + 2] += ((rowBuf[i + 2] * g + rowBuf[i + 11] * f) * pr + (rowBuf[i + 5] * g + rowBuf[i + 14] * f) * pm + (rowBuf[i + 8] * g + rowBuf[i + 17] * f)) * s2;
  }
}

/** Compute env (+bg) for a sun/moon configuration. */
export function computeSky(req: SkyRequest): SkyResult {
  const tStart = now();
  ensureLuts();
  const tLuts = now() - tStart;
  const E0 = ATMOSPHERE.solarIlluminanceLux;
  const c = Math.min(Math.max((req.cloudPct ?? 0) / 100, 0), 1);

  const [sdx, sdy, sdz] = req.sunDir;
  const sunElev = Math.asin(Math.max(-1, Math.min(1, sdy)));
  const sunAz = Math.atan2(sdz, sdx);

  // moon: visible, lit, and bright enough to matter
  const mf = req.moonFraction ?? 0;
  const md = req.moonDir;
  const moonElev = md ? Math.asin(Math.max(-1, Math.min(1, md[1]))) : -PI / 2;
  const moonAz = md ? Math.atan2(md[2], md[0]) : 0;
  const moonTOA = md ? moonIlluminanceTOA(mf) : 0;
  // scattered moonlight only matters once the sky is dark
  const moonSky = md && moonElev > -4 * DEG && sunElev < -8 * DEG && moonTOA > 1e-4;

  const tSv0 = now();
  const lutS = skyView(svSun, sunElev);
  const lutM = moonSky ? skyView(svMoon, moonElev) : null;
  const tSv = now() - tSv0;

  const tFill0 = now();
  // the sky is evaluated at env resolution (exact phase per texel) and
  // upsampled for bg; stars and the moon go into bg at full resolution
  const W = ENV_W;
  const H = ENV_H;
  // double-buffered: an image stays valid until the update after next, and
  // the slider doesn't churn 10 MB of garbage per step
  const slot = req.recycle ? (poolSlot ^= 1) : -1;
  const img = slot >= 0 ? (envPool[slot] ??= new Float32Array(W * H * 4)) : new Float32Array(W * H * 4);

  // per-column relative azimuth → LUT column
  const colI = new Int32Array(W);
  const colF = new Float32Array(W);
  const cosPhi = new Float32Array(W);
  const mColI = new Int32Array(W);
  const mColF = new Float32Array(W);
  const mCosPhi = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const az = ((x + 0.5) / W - 0.5) * 2 * PI;
    let d = az - sunAz;
    d -= 2 * PI * Math.round(d / (2 * PI));
    const phi = Math.abs(d);
    cosPhi[x] = Math.cos(phi);
    const f = (phi / PI) * (NA - 1);
    colI[x] = Math.min(f | 0, NA - 2);
    colF[x] = f - colI[x];
    if (lutM) {
      let dm = az - moonAz;
      dm -= 2 * PI * Math.round(dm / (2 * PI));
      const pm = Math.abs(dm);
      mCosPhi[x] = Math.cos(pm);
      const fm = (pm / PI) * (NA - 1);
      mColI[x] = Math.min(fm | 0, NA - 2);
      mColF[x] = fm - mColI[x];
    }
  }

  const sinS = Math.sin(sunElev);
  const cosS = Math.cos(sunElev);
  const sinM = Math.sin(moonElev);
  const cosM = Math.cos(moonElev);
  const moonScale = moonTOA; // moon LUT is per unit illuminance
  const glowZ = ATMOSPHERE.skyglowZenith * (1 + 3 * c);

  // --- upper hemisphere (everything above the geometric horizon) ---------
  const yHorizon = Math.ceil((-DIP / PI + 0.5) * H - 0.5); // first sky row
  const dOmegaBase = ((2 * PI) / W) * (PI / H);
  const sun: LightRow = { lut: lutS, colI, colF, cosPhi, sinL: sinS, cosL: cosS, s: [E0, E0, E0] };
  const moonL: LightRow | null = lutM
    ? { lut: lutM, colI: mColI, colF: mColF, cosPhi: mCosPhi, sinL: sinM, cosL: cosM, s: [moonScale * MOON_TINT[0], moonScale * MOON_TINT[1], moonScale * MOON_TINT[2]] }
    : null;
  for (let y = yHorizon; y < H; y++) {
    const e = ((y + 0.5) / H - 0.5) * PI;
    const se = Math.sin(e);
    const ce = Math.cos(e);
    const glow = glowZ * (1 + 5 * Math.exp(-Math.max(e, 0) / (12 * DEG)));
    const base = y * W * 4;
    const g0 = glow * SKYGLOW_TINT[0];
    const g1 = glow * SKYGLOW_TINT[1];
    const g2 = glow * SKYGLOW_TINT[2];
    for (let x = 0; x < W; x++) {
      const o = base + x * 4;
      img[o] = g0;
      img[o + 1] = g1;
      img[o + 2] = g2;
      img[o + 3] = 1;
    }
    addLightRow(img, base, W, e, se, ce, sun);
    if (moonL) addLightRow(img, base, W, e, se, ce, moonL);
  }
  const skyIrradiance = (): Vec3 => {
    let eR = 0;
    let eG = 0;
    let eB = 0;
    for (let y = yHorizon; y < H; y++) {
      const e = ((y + 0.5) / H - 0.5) * PI;
      if (e <= 0) continue; // cosine-weighted: texels above e = 0 only
      let rr = 0;
      let rg = 0;
      let rb = 0;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const o = base + x * 4;
        rr += img[o];
        rg += img[o + 1];
        rb += img[o + 2];
      }
      const k = dOmegaBase * Math.cos(e) * Math.sin(e);
      eR += rr * k;
      eG += rg * k;
      eB += rb * k;
    }
    return [eR, eG, eB];
  };
  let skyH = skyIrradiance();

  // --- direct sun / moon ---------------------------------------------------
  const Tsun: Vec3 = transmittanceAt(sunElev / DEG);
  const dniClear = E0 * luminance(Tsun);
  const tMax = Math.max(Tsun[0], Tsun[1], Tsun[2], 1e-12);
  const sunColor: Vec3 = dniClear > 0 ? normMax(desat([Tsun[0] / tMax, Tsun[1] / tMax, Tsun[2] / tMax])) : [1, 0.5, 0.2];
  const sunDamp = (1 - c) ** 1.5;
  const sinAlt = Math.max(sinS, 0);
  const sunH = [E0 * Tsun[0] * sinAlt, E0 * Tsun[1] * sinAlt, E0 * Tsun[2] * sinAlt];

  let moonLux = 0;
  let moonColor: Vec3 = [0.92, 0.95, 1];
  let moonH: Vec3 = [0, 0, 0];
  if (md && moonElev > -1 * DEG) {
    const Tm = transmittanceAt(moonElev / DEG);
    const mc: Vec3 = [Tm[0] * MOON_TINT[0], Tm[1] * MOON_TINT[1], Tm[2] * MOON_TINT[2]];
    moonLux = moonTOA * luminance(mc) * (1 - c) ** 2;
    const mm = Math.max(mc[0], mc[1], mc[2], 1e-12);
    moonColor = normMax(desat([mc[0] / mm, mc[1] / mm, mc[2] / mm]));
    const s = Math.max(sinM, 0) * moonTOA * (1 - c) ** 2;
    moonH = [mc[0] * s, mc[1] * s, mc[2] * s];
  }

  // --- clouds: blend toward a CIE overcast sky of matching illuminance -------
  if (c > 0) {
    const eClearY = luminance(skyH) + luminance(sunH as Vec3) + luminance(moonH);
    // thick overcast passes ~40% of the clear-day global illuminance
    const eOc = 0.4 * eClearY;
    const Lz = (9 * eOc) / (7 * PI);
    // cloud tint: the clear global light, half desaturated
    const tint = [skyH[0] + sunH[0] + moonH[0], skyH[1] + sunH[1] + moonH[1], skyH[2] + sunH[2] + moonH[2]];
    const ty = Math.max(luminance(tint as Vec3), 1e-30);
    const oc = [0.5 + (0.5 * tint[0]) / ty, 0.5 + (0.5 * tint[1]) / ty, 0.5 + (0.5 * tint[2]) / ty];
    const oy = luminance(oc as Vec3);
    const w = c;
    for (let y = yHorizon; y < H; y++) {
      const e = ((y + 0.5) / H - 0.5) * PI;
      const Loc = (Lz * (1 + 2 * Math.max(Math.sin(e), 0))) / 3 / oy;
      const l0 = Loc * oc[0] * w;
      const l1 = Loc * oc[1] * w;
      const l2 = Loc * oc[2] * w;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const o = base + x * 4;
        img[o] = img[o] * (1 - w) + l0;
        img[o + 1] = img[o + 1] * (1 - w) + l1;
        img[o + 2] = img[o + 2] * (1 - w) + l2;
      }
    }
    skyH = skyIrradiance();
  }

  const sunLux = dniClear * sunDamp * (req.ridgeVisibility ?? 1);

  // --- below the horizon: lit ground seen through the haze -------------------
  const alb = ATMOSPHERE.groundAlbedo;
  const gE = [
    skyH[0] + sunH[0] * sunDamp + moonH[0],
    skyH[1] + sunH[1] * sunDamp + moonH[1],
    skyH[2] + sunH[2] * sunDamp + moonH[2],
  ];
  const Lg = [(alb * GROUND_TINT[0] * gE[0]) / PI, (alb * GROUND_TINT[1] * gE[1]) / PI, (alb * GROUND_TINT[2] * gE[2]) / PI];
  const hRow = yHorizon * W * 4;
  const ext = [RAY[0] + MIE_T, RAY[1] + MIE_T, RAY[2] + MIE_T];
  for (let y = 0; y < yHorizon; y++) {
    const e = ((y + 0.5) / H - 0.5) * PI;
    // the knoll sits ~150 m above the valley floor
    const dist = Math.min(0.15 / Math.max(Math.sin(-e - DIP * 0.5), 1e-4), 60);
    const T0 = Math.exp(-ext[0] * dist);
    const T1 = Math.exp(-ext[1] * dist);
    const T2 = Math.exp(-ext[2] * dist);
    const base = y * W * 4;
    for (let x = 0; x < W; x++) {
      const o = base + x * 4;
      const h = hRow + x * 4;
      img[o] = Lg[0] * T0 + img[h] * (1 - T0);
      img[o + 1] = Lg[1] * T1 + img[h + 1] * (1 - T1);
      img[o + 2] = Lg[2] * T2 + img[h + 2] * (1 - T2);
      img[o + 3] = 1;
    }
  }

  // broadband correction over the whole env (luminance unchanged)
  {
    const k = 1 - BROADBAND_DESAT;
    for (let o = 0; o < img.length; o += 4) {
      const y = 0.2126 * img[o] + 0.7152 * img[o + 1] + 0.0722 * img[o + 2];
      img[o] = Math.max(0, y + (img[o] - y) * k);
      img[o + 1] = Math.max(0, y + (img[o + 1] - y) * k);
      img[o + 2] = Math.max(0, y + (img[o + 2] - y) * k);
    }
    skyH = desat(skyH);
  }

  // --- bg = env upsampled + stars + moon disc ---------------------------------
  const env: EquirectImage = { w: W, h: H, data: img };
  let bg: EquirectImage | null = null;
  const tBg0 = now();
  if (!req.envOnly) {
    bg = upsample2(img, W, H, slot >= 0 ? (bgPool[slot] ??= new Float32Array(BG_W * BG_H * 4)) : new Float32Array(BG_W * BG_H * 4));
    const fadeClouds = (1 - c) ** 2;
    if (req.date !== undefined && req.minutes !== undefined && fadeClouds > 0.01) {
      addStars(bg, req.date, req.minutes, fadeClouds);
    }
    if (md && moonElev > -0.5 * DEG && fadeClouds > 0.01) {
      addMoonDisc(bg, md, mf, req.moonBrightLimbDeg ?? 0, moonTOA * fadeClouds);
    }
  }

  const skyLux = luminance(skyH);
  const tBg = now() - tBg0;
  const tFill = tBg0 - tFill0;
  return {
    env,
    bg,
    skyHorizontalLux: skyLux,
    skyHorizontalRgb: skyH,
    sun: { illuminanceLux: sunLux, colorLinear: sunColor, transmittance: Tsun },
    moon: { illuminanceLux: moonLux, colorLinear: moonColor },
    globalHorizontalLux: skyLux + sunLux * sinAlt + moonLux * Math.max(sinM, 0),
    timings: { luts: tLuts, skyView: tSv, fill: tFill, bg: tBg, total: now() - tStart },
  };
}

let hScratch = new Float32Array(0);

/** 2× bilinear upsample (texel-centred, wraps in u, clamps in v) into `out`.
 * Rows more than ~25° below the horizon (always under the lawn/backdrop)
 * skip the vertical blend. */
function upsample2(src: Float32Array, W: number, H: number, out: Float32Array): EquirectImage {
  const w = W * 2;
  const h = H * 2;
  if (hScratch.length !== w * H * 3) hScratch = new Float32Array(w * H * 3);
  const hs = hScratch;
  // horizontal pass: env row → 2W texels (RGB)
  for (let y = 0; y < H; y++) {
    const sb = y * W * 4;
    const ob = y * w * 3;
    for (let x = 0; x < W; x++) {
      const c = sb + x * 4;
      const l = sb + ((x + W - 1) % W) * 4;
      const r = sb + ((x + 1) % W) * 4;
      const o = ob + x * 6;
      hs[o] = 0.25 * src[l] + 0.75 * src[c];
      hs[o + 1] = 0.25 * src[l + 1] + 0.75 * src[c + 1];
      hs[o + 2] = 0.25 * src[l + 2] + 0.75 * src[c + 2];
      hs[o + 3] = 0.75 * src[c] + 0.25 * src[r];
      hs[o + 4] = 0.75 * src[c + 1] + 0.25 * src[r + 1];
      hs[o + 5] = 0.75 * src[c + 2] + 0.25 * src[r + 2];
    }
  }
  // vertical pass
  const yLow = Math.floor(h * (0.5 - 25 / 180));
  for (let Y = 0; Y < h; Y++) {
    const j = Y >> 1;
    const ob = Y * w * 4;
    const a = j * w * 3;
    if (Y < yLow) {
      for (let x = 0; x < w; x++) {
        const i = a + x * 3;
        const o = ob + x * 4;
        out[o] = hs[i];
        out[o + 1] = hs[i + 1];
        out[o + 2] = hs[i + 2];
        out[o + 3] = 1;
      }
      continue;
    }
    const k = Y & 1 ? Math.min(j + 1, H - 1) : Math.max(j - 1, 0);
    const b = k * w * 3;
    for (let x = 0; x < w; x++) {
      const i = x * 3;
      const o = ob + x * 4;
      out[o] = 0.75 * hs[a + i] + 0.25 * hs[b + i];
      out[o + 1] = 0.75 * hs[a + i + 1] + 0.25 * hs[b + i + 1];
      out[o + 2] = 0.75 * hs[a + i + 2] + 0.25 * hs[b + i + 2];
      out[o + 3] = 1;
    }
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------------------
// Stars and moon (bg only)
// ---------------------------------------------------------------------------

/** perceptual gain: point sources read brighter to the eye than their
 * texel-averaged luminance suggests */
const STAR_GAIN = 8;

function julianDaysJ2000(date: string, minutes: number): number {
  const [y, mo, d] = date.split('-').map(Number);
  const tz = tzOffsetMinutes(date);
  const utc = Date.UTC(y, mo - 1, d) + (minutes - tz) * 60000;
  return (utc - Date.UTC(2000, 0, 1, 12)) / 86400000;
}

function splat(img: EquirectImage, dir: number[], rgb: number[], flux: number): void {
  // flux in lux → luminance over the texel footprint, bilinear so the
  // total stays right wherever the star falls
  const { w, h, data } = img;
  const u = Math.atan2(dir[2], dir[0]) / (2 * PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / PI + 0.5;
  const fx = u * w - 0.5;
  const fy = v * h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const omega = ((2 * PI) / w) * (PI / h) * Math.max(Math.cos(((fy + 0.5) / h - 0.5) * PI), 1e-3);
  const L = flux / omega;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = j ? ty : 1 - ty;
    for (let i = 0; i < 2; i++) {
      const xx = (((x0 + i) % w) + w) % w;
      const wt = wy * (i ? tx : 1 - tx) * L;
      const o = (yy * w + xx) * 4;
      data[o] += rgb[0] * wt;
      data[o + 1] += rgb[1] * wt;
      data[o + 2] += rgb[2] * wt;
    }
  }
}

let starVecs: Float64Array | null = null;

function addStars(bg: EquirectImage, date: string, minutes: number, fade: number): void {
  const n = STAR_CATALOG.length;
  if (!starVecs) {
    // equatorial unit vectors (x → RA 0h, y → RA 6h, z → pole), once
    starVecs = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = STAR_CATALOG[i];
      const ra = s.ra * 15 * DEG;
      const dec = s.dec * DEG;
      starVecs[i * 3] = Math.cos(dec) * Math.cos(ra);
      starVecs[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
      starVecs[i * 3 + 2] = Math.sin(dec);
    }
  }
  const D = julianDaysJ2000(date, minutes);
  const lst = ((280.46061837 + 360.98564736629 * D + VENUE.lon) % 360) * DEG;
  const cT = Math.cos(lst);
  const sT = Math.sin(lst);
  const sP = Math.sin(VENUE.lat * DEG);
  const cP = Math.cos(VENUE.lat * DEG);
  // model −z faces true azimuth 50° (FACADE_AZ_DEG)
  const cF = Math.cos(50 * DEG);
  const sF = Math.sin(50 * DEG);
  const dir = [0, 0, 0];
  const rgb = [0, 0, 0];
  const T = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const X = starVecs[i * 3];
    const Y = starVecs[i * 3 + 1];
    const Z = starVecs[i * 3 + 2];
    const cH = X * cT + Y * sT; // cos δ cos H
    const sH = X * sT - Y * cT; // cos δ sin H
    const up = sP * Z + cP * cH;
    if (up < 0.01) continue;
    const north = cP * Z - sP * cH;
    const east = -sH;
    dir[0] = east * cF - north * sF;
    dir[1] = up;
    dir[2] = -(north * cF + east * sF);
    transmittanceLut(R0, up, T);
    const s = STAR_CATALOG[i];
    const e = 2.54e-6 * 10 ** (-0.4 * s.mag) * STAR_GAIN * fade;
    rgb[0] = s.rgb[0] * T[0];
    rgb[1] = s.rgb[1] * T[1];
    rgb[2] = s.rgb[2] * T[2];
    splat(bg, dir, rgb, e);
  }
}

function addMoonDisc(bg: EquirectImage, m: Vec3, fraction: number, limbDeg: number, eMoon: number): void {
  const T = transmittanceAt(Math.asin(m[1]) / DEG);
  const R = ATMOSPHERE.moonAngularRadiusRad;
  const omegaMoon = PI * R * R;
  const f = Math.max(fraction, 1e-3);
  // mean luminance of the lit part; earthshine ≈ 2e-4 of full on the dark part
  const Llit = eMoon / (f * omegaMoon);
  const Ldark = (ATMOSPHERE.fullMoonLux / omegaMoon) * 2e-4 * (1 - f);
  // tangent frame on the sky: up toward the zenith, right = m × up
  let ux = -m[1] * m[0];
  let uy = 1 - m[1] * m[1];
  let uz = -m[1] * m[2];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const rx = m[1] * uz - m[2] * uy;
  const ry = m[2] * ux - m[0] * uz;
  const rz = m[0] * uy - m[1] * ux;
  const chi = limbDeg * DEG;
  const bx = Math.sin(chi); // bright-limb axis in (right, up)
  const by = Math.cos(chi);
  const k = 1 - 2 * f;
  const { w, h, data } = bg;
  const u0 = Math.atan2(m[2], m[0]) / (2 * PI) + 0.5;
  const v0 = Math.asin(m[1]) / PI + 0.5;
  const cx = Math.floor(u0 * w);
  const cy = Math.floor(v0 * h);
  const SS = 6;
  const span = 2;
  // texels narrow toward the zenith: widen the column window by 1/cos(el)
  const spanX = Math.min(w >> 1, Math.ceil(span + (R * w) / (2 * PI * Math.max(Math.sqrt(1 - m[1] * m[1]), 0.02))));
  for (let yy = cy - span; yy <= cy + span; yy++) {
    if (yy < 0 || yy >= h) continue;
    for (let xx0 = cx - spanX; xx0 <= cx + spanX; xx0++) {
      const xx = ((xx0 % w) + w) % w;
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        const v = (yy + (sy + 0.5) / SS) / h;
        const el = (v - 0.5) * PI;
        const ce = Math.cos(el);
        const se = Math.sin(el);
        for (let sx = 0; sx < SS; sx++) {
          const u = (xx0 + (sx + 0.5) / SS) / w;
          const az = (u - 0.5) * 2 * PI;
          const dx = ce * Math.cos(az);
          const dz = ce * Math.sin(az);
          const dot = dx * m[0] + se * m[1] + dz * m[2];
          if (dot < Math.cos(R * 1.05)) continue;
          const ox = (dx * rx + se * ry + dz * rz) / R;
          const oy = (dx * ux + se * uy + dz * uz) / R;
          const q = ox * ox + oy * oy;
          if (q > 1) continue;
          const xp = ox * bx + oy * by;
          const yp = ox * by - oy * bx;
          const lit = xp >= k * Math.sqrt(Math.max(0, 1 - yp * yp));
          acc += lit ? Llit : Ldark;
        }
      }
      if (acc <= 0) continue;
      const L = acc / (SS * SS);
      const o = (yy * w + xx) * 4;
      data[o] += L * T[0] * MOON_TINT[0];
      data[o + 1] += L * T[1] * MOON_TINT[1];
      data[o + 2] += L * T[2] * MOON_TINT[2];
    }
  }
}

// ---------------------------------------------------------------------------
// Store adapter
// ---------------------------------------------------------------------------

type Base = Omit<SkyState, 'env' | 'bg' | 'skyHorizontalLux' | 'ev100' | 'version'>;

export interface PhysicalSkyExtras {
  /** horizontal illuminance sky+sun+moon, lux (what the exposure meters) */
  globalHorizontalLux: number;
  skyHorizontalRgb: Vec3;
  timings: SkyResult['timings'];
}

let lastExtras: PhysicalSkyExtras | null = null;
/** Diagnostics of the most recent physical sky evaluation. */
export function lastSkyExtras(): PhysicalSkyExtras | null {
  return lastExtras;
}

let memo: { key: string; r: SkyResult } | null = null;

/** SkyModel for skyStore.setSkyModel(): physical env/bg + sun/moon light.
 * Exposure-only changes (evComp, autoEV) reuse the last images. */
export function physicalSkyModel(inp: SkyInput, base: Base) {
  const key = [
    ...base.sun.dir,
    ...base.moon.dir,
    base.moon.fraction,
    base.moon.brightLimbDeg,
    base.sun.ridgeVisibility,
    inp.cloudPct,
    inp.date,
    inp.minutes,
  ].join('|');
  const r =
    memo && memo.key === key
      ? memo.r
      : computeSky({
          sunDir: base.sun.dir,
          moonDir: base.moon.dir,
          moonFraction: base.moon.fraction,
          moonBrightLimbDeg: base.moon.brightLimbDeg,
          cloudPct: inp.cloudPct,
          ridgeVisibility: base.sun.ridgeVisibility,
          date: inp.date,
          minutes: inp.minutes,
          recycle: true,
        });
  memo = { key, r };
  lastExtras = { globalHorizontalLux: r.globalHorizontalLux, skyHorizontalRgb: r.skyHorizontalRgb, timings: r.timings };
  const metered = inp.autoEV ? meteredEV100(r.globalHorizontalLux) : presetEV100(r.globalHorizontalLux);
  return {
    env: r.env,
    bg: r.bg ?? r.env,
    skyHorizontalLux: r.skyHorizontalLux,
    // +comp brightens: exposureScale = 1/(1.2·2^EV)
    ev100: metered - inp.evComp,
    sun: { illuminanceLux: r.sun.illuminanceLux, colorLinear: r.sun.colorLinear },
    moon: { illuminanceLux: r.moon.illuminanceLux, colorLinear: r.moon.colorLinear },
  };
}
