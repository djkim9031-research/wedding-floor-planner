import { DataUtils } from 'three';
import { describe, expect, it } from 'vitest';
import {
  avgLuminanceFromEv100,
  blenderFilmExposure,
  ev100FromAvgLuminance,
  ev100FromIlluminance,
  ev100FromScale,
  exposureScale,
  illuminanceFromEv100,
  meteredEV100,
  presetEV100,
} from './exposure';
import { toHalfArray } from './half';

describe('exposure formulas', () => {
  it('exposureScale ↔ EV100 round-trips', () => {
    for (const ev of [-4, 0, 1.5, 7.25, 12, 15.3]) {
      expect(ev100FromScale(exposureScale(ev))).toBeCloseTo(ev, 10);
    }
    // saturation-based: Lmax = 1.2·2^EV maps to 1
    expect(exposureScale(10) * 1.2 * 1024).toBeCloseTo(1, 12);
  });

  it('reflected and incident meters round-trip', () => {
    for (const ev of [0, 5, 10, 15]) {
      expect(ev100FromAvgLuminance(avgLuminanceFromEv100(ev))).toBeCloseTo(ev, 10);
      expect(ev100FromIlluminance(illuminanceFromEv100(ev))).toBeCloseTo(ev, 10);
    }
    // sunny-16: ~100 klux ↔ EV ≈ 15.3
    expect(ev100FromIlluminance(100000)).toBeCloseTo(15.29, 1);
  });

  it('Blender film exposure matches the raster scale for radiance = L/683', () => {
    // Blender maps W/(m²·sr) × 2^film to display; raster maps cd/m² × scale
    for (const ev of [2, 9, 14]) {
      for (const comp of [-1, 0, 1.5]) {
        const L = 1000; // cd/m²
        const raster = L * exposureScale(ev - comp);
        const blender = (L / 683) * 2 ** blenderFilmExposure(ev, comp);
        expect(blender).toBeCloseTo(raster, 9);
      }
    }
  });

  it('sky preset: noon ≈ 14–15, sunset ≈ 11–12, civil dusk ≈ 6–8, night ≈ 0–2', () => {
    const noon = presetEV100(110000);
    const sunset = presetEV100(1000);
    const dusk = presetEV100(40);
    const night = presetEV100(0.02);
    expect(noon).toBeGreaterThanOrEqual(14);
    expect(noon).toBeLessThanOrEqual(15.2);
    expect(sunset).toBeGreaterThanOrEqual(11);
    expect(sunset).toBeLessThanOrEqual(12);
    expect(dusk).toBeGreaterThanOrEqual(6);
    expect(dusk).toBeLessThanOrEqual(8);
    expect(night).toBeGreaterThanOrEqual(0);
    expect(night).toBeLessThanOrEqual(2);
  });

  it('both metering curves are monotonic in illuminance', () => {
    let pPrev = -Infinity;
    let mPrev = -Infinity;
    for (let l = -8; l <= 17; l += 0.25) {
      const E = 2 ** l;
      const p = presetEV100(E);
      const m = meteredEV100(E);
      expect(p).toBeGreaterThanOrEqual(pPrev);
      expect(m).toBeGreaterThan(mPrev);
      pPrev = p;
      mPrev = m;
    }
    // auto (scene) exposure reads brighter than the moody preset at dusk
    expect(meteredEV100(40)).toBeLessThan(presetEV100(40));
  });
});

describe('half-float packing', () => {
  it('matches three.js decoding and saturates instead of overflowing', () => {
    const src = new Float32Array([0, 1, 0.5, 3.14159, 1234.5, 6e-5, 1e-8, 65504, 1e6, Infinity, NaN, -2]);
    const h = toHalfArray(src);
    const back = Array.from(h, (x) => DataUtils.fromHalfFloat(x));
    for (const i of [0, 1, 2, 3, 4, 5, 7, 11]) {
      expect(Math.abs(back[i] - src[i])).toBeLessThanOrEqual(Math.abs(src[i]) * 1e-3 + 1e-7);
    }
    expect(back[6]).toBeLessThan(1e-7);
    expect(back[8]).toBe(65504);
    expect(back[9]).toBe(65504);
    expect(Number.isFinite(back[10])).toBe(true);
  });
});
