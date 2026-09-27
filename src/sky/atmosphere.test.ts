import { describe, expect, it } from 'vitest';
import { BG_H, BG_W, computeSky, ENV_H, ENV_W, moonIlluminanceTOA, type SkyRequest } from './atmosphere';
import { dirFromEquirectUv, dirFromModelAzEl, equirectUv, sampleEquirect } from './equirect';
import type { EquirectImage, Vec3 } from './types';

const sunAt = (altDeg: number, azModelDeg = 180): Vec3 => dirFromModelAzEl(azModelDeg, altDeg);
const ghi = (altDeg: number, extra: Partial<SkyRequest> = {}): number =>
  computeSky({ sunDir: sunAt(altDeg), envOnly: true, ...extra }).globalHorizontalLux;

/** mean RGB over a patch of sky (elevations e0..e1, azimuths around az) */
function patch(img: EquirectImage, az: number, e0: number, e1: number): Vec3 {
  const acc: Vec3 = [0, 0, 0];
  let n = 0;
  for (let e = e0; e <= e1 + 1e-9; e += 0.25) {
    for (let a = az - 10; a <= az + 10; a += 2.5) {
      const c = sampleEquirect(img, dirFromModelAzEl(a, e));
      acc[0] += c[0];
      acc[1] += c[1];
      acc[2] += c[2];
      n++;
    }
  }
  return [acc[0] / n, acc[1] / n, acc[2] / n];
}

describe('physical sky — illuminance', () => {
  it('global horizontal illuminance at 60° is a clear-day 85–120 klux', () => {
    const e = ghi(60);
    expect(e).toBeGreaterThan(85000);
    expect(e).toBeLessThan(120000);
  });

  it('direct normal illuminance at high sun is ≈100–110 klux', () => {
    const r = computeSky({ sunDir: sunAt(75), envOnly: true });
    expect(r.sun.illuminanceLux).toBeGreaterThan(98000);
    expect(r.sun.illuminanceLux).toBeLessThan(112000);
  });

  it('at sunset (0°) the sky gives 0.3–1.5 klux', () => {
    const e = ghi(0);
    expect(e).toBeGreaterThan(300);
    expect(e).toBeLessThan(1500);
  });

  it('end of civil twilight (−6°) is 1.5–10 lux', () => {
    const e = ghi(-6);
    expect(e).toBeGreaterThan(1.5);
    expect(e).toBeLessThan(10);
  });

  it('end of nautical twilight (−12°) is 0.005–0.08 lux', () => {
    const e = ghi(-12);
    expect(e).toBeGreaterThan(0.005);
    expect(e).toBeLessThan(0.08);
  });

  it('decreases monotonically through twilight', () => {
    const alts = [30, 10, 2, 0, -2, -4, -6, -9, -12];
    const es = alts.map((a) => ghi(a));
    for (let i = 1; i < es.length; i++) expect(es[i]).toBeLessThan(es[i - 1]);
  });

  it('the sun disc is shadowed once it is well below the horizon', () => {
    expect(computeSky({ sunDir: sunAt(-2), envOnly: true }).sun.illuminanceLux).toBe(0);
    expect(computeSky({ sunDir: sunAt(5), envOnly: true }).sun.illuminanceLux).toBeGreaterThan(10000);
  });

  it('the ridge gates only the direct sun, not the sky', () => {
    const open = computeSky({ sunDir: sunAt(1.5), envOnly: true });
    const hidden = computeSky({ sunDir: sunAt(1.5), envOnly: true, ridgeVisibility: 0 });
    expect(hidden.sun.illuminanceLux).toBe(0);
    expect(hidden.skyHorizontalLux).toBeCloseTo(open.skyHorizontalLux, 6);
  });
});

describe('physical sky — colour', () => {
  it('the day zenith is blue (b/r > 1.5)', () => {
    const z = sampleEquirect(computeSky({ sunDir: sunAt(60), envOnly: true }).env, [0, 1, 0]);
    expect(z[2] / z[0]).toBeGreaterThan(1.5);
  });

  it('the twilight zenith stays blue (ozone), not grey', () => {
    for (const alt of [-2, -4, -6]) {
      const z = sampleEquirect(computeSky({ sunDir: sunAt(alt), envOnly: true }).env, [0, 1, 0]);
      expect(z[2] / z[0]).toBeGreaterThan(1.2);
    }
  });

  it('at −4° the anti-solar sky shows the Belt of Venus over the Earth shadow', () => {
    // sun at model az 180 → anti-solar az 0
    const env = computeSky({ sunDir: sunAt(-4), envOnly: true }).env;
    const band = patch(env, 0, 3, 12);
    const low = patch(env, 0, 0.3, 2);
    expect(band[0]).toBeGreaterThan(band[2]); // pink: r > b
    expect(low[2] / low[0]).toBeGreaterThan(band[2] / band[0]); // shadow bluer
  });

  it('sunset sky is warm toward the sun and cool opposite', () => {
    const env = computeSky({ sunDir: sunAt(0.5), envOnly: true }).env;
    const sunward = patch(env, 180, 1, 4);
    const high = sampleEquirect(env, [0, 1, 0]);
    expect(sunward[0] / sunward[2]).toBeGreaterThan(2);
    expect(high[2] / high[0]).toBeGreaterThan(1.2);
  });

  it('sun colour reddens toward the horizon', () => {
    const hi = computeSky({ sunDir: sunAt(60), envOnly: true }).sun.colorLinear;
    const lo = computeSky({ sunDir: sunAt(3), envOnly: true }).sun.colorLinear;
    expect(hi[2]).toBeGreaterThan(0.72); // Rayleigh: exp(−Δτ·m) ≈ 0.79 at 60°
    expect(lo[2]).toBeLessThan(hi[2] * 0.6);
    expect(Math.max(...hi)).toBeCloseTo(1, 6);
  });
});

describe('physical sky — moon, clouds, stars', () => {
  it('a full moon high up gives 0.1–0.3 lux', () => {
    const r = computeSky({ sunDir: sunAt(-30), moonDir: dirFromModelAzEl(40, 65), moonFraction: 1, envOnly: true });
    expect(r.moon.illuminanceLux).toBeGreaterThan(0.1);
    expect(r.moon.illuminanceLux).toBeLessThan(0.3);
    // a quarter moon is roughly a tenth of full (phase law)
    expect(moonIlluminanceTOA(0.5) / moonIlluminanceTOA(1)).toBeGreaterThan(0.06);
    expect(moonIlluminanceTOA(0.5) / moonIlluminanceTOA(1)).toBeLessThan(0.15);
  });

  it('overcast follows the CIE distribution and damps the sun', () => {
    const clear = computeSky({ sunDir: sunAt(50), envOnly: true });
    const oc = computeSky({ sunDir: sunAt(50), envOnly: true, cloudPct: 100 });
    expect(oc.sun.illuminanceLux).toBe(0);
    const z = sampleEquirect(oc.env, [0, 1, 0]);
    const h = patch(oc.env, 90, 0.5, 1.5);
    const ratio = (0.2126 * z[0] + 0.7152 * z[1] + 0.0722 * z[2]) / (0.2126 * h[0] + 0.7152 * h[1] + 0.0722 * h[2]);
    expect(ratio).toBeGreaterThan(2.5); // L(90°)/L(0°) = 3 for CIE overcast
    expect(ratio).toBeLessThan(3.3);
    expect(oc.globalHorizontalLux).toBeGreaterThan(0.25 * clear.globalHorizontalLux);
    expect(oc.globalHorizontalLux).toBeLessThan(0.6 * clear.globalHorizontalLux);
  });

  it('stars and the moon go into bg only, above the horizon', () => {
    const req: SkyRequest = {
      sunDir: sunAt(-35),
      moonDir: dirFromModelAzEl(120, 40),
      moonFraction: 0.8,
      moonBrightLimbDeg: 60,
      date: '2026-09-20',
      minutes: 23 * 60,
    };
    const r = computeSky(req);
    expect(r.bg).not.toBeNull();
    const bg = r.bg!;
    // bg = upsampled env + point sources: it only ever adds light
    let brighter = 0;
    let maxY = 0;
    let maxAt = [0, 0];
    for (let y = 0; y < bg.h; y++) {
      for (let x = 0; x < bg.w; x++) {
        const o = (y * bg.w + x) * 4;
        const e = sampleEquirect(r.env, dirFromEquirectUv((x + 0.5) / bg.w, (y + 0.5) / bg.h));
        const d = bg.data[o + 1] - e[1];
        if (d > 0.05 * e[1] + 1e-4) {
          brighter++;
          expect(y).toBeGreaterThanOrEqual(bg.h / 2 - 1); // never below the horizon
        }
        if (bg.data[o + 1] > maxY) {
          maxY = bg.data[o + 1];
          maxAt = [x, y];
        }
      }
    }
    expect(brighter).toBeGreaterThan(300); // a real star field
    // the brightest texel is the moon, where equirectUv says it is
    const [u, v] = equirectUv(req.moonDir!);
    expect(Math.abs(maxAt[0] - (u * bg.w - 0.5))).toBeLessThan(2);
    expect(Math.abs(maxAt[1] - (v * bg.h - 0.5))).toBeLessThan(2);
  });
});

describe('physical sky — image conventions and sanity', () => {
  it('sizes: env 512×256, bg 1024×512', () => {
    const r = computeSky({ sunDir: sunAt(20) });
    expect([r.env.w, r.env.h]).toEqual([ENV_W, ENV_H]);
    expect([r.bg!.w, r.bg!.h]).toEqual([BG_W, BG_H]);
    expect(ENV_W).toBe(512);
    expect(BG_W).toBe(1024);
  });

  it('equirectUv and dirFromEquirectUv round-trip', () => {
    for (const [u, v] of [
      [0.1, 0.3],
      [0.5, 0.5],
      [0.77, 0.91],
      [0.99, 0.02],
    ]) {
      const [u2, v2] = equirectUv(dirFromEquirectUv(u, v));
      expect(u2).toBeCloseTo(u, 9);
      expect(v2).toBeCloseTo(v, 9);
    }
  });

  it('the aureole sits where equirectUv(sunDir) says (rows bottom-up)', () => {
    // g = 0.8 Mie is ~20° wide, so test the azimuth on the sun's own row and
    // the vertical sense against the mirrored (below-horizon) direction; the
    // moon test below pins exact texels in both axes
    for (const [alt, az] of [
      [35, 70],
      [55, 250],
      [20, 0],
    ]) {
      const dir = sunAt(alt, az);
      const env = computeSky({ sunDir: dir, envOnly: true }).env;
      const [u, v] = equirectUv(dir);
      const row = Math.round(v * env.h - 0.5);
      let best = -1;
      let bx = 0;
      for (let x = 0; x < env.w; x++) {
        const g = env.data[(row * env.w + x) * 4 + 1];
        if (g > best) {
          best = g;
          bx = x;
        }
      }
      const dx = Math.abs(bx - (u * env.w - 0.5));
      expect(Math.min(dx, env.w - dx)).toBeLessThan(1.5);
      const mirror: Vec3 = [dir[0], -dir[1], dir[2]];
      const anti: Vec3 = [-dir[0], dir[1], -dir[2]];
      expect(sampleEquirect(env, dir)[1]).toBeGreaterThan(3 * sampleEquirect(env, mirror)[1]);
      expect(sampleEquirect(env, dir)[1]).toBeGreaterThan(2 * sampleEquirect(env, anti)[1]);
    }
  });

  it('env and bg are finite and non-negative everywhere', () => {
    const cases: SkyRequest[] = [
      { sunDir: sunAt(88) },
      { sunDir: sunAt(0.2, 30), cloudPct: 40 },
      { sunDir: sunAt(-3.3, 300) },
      { sunDir: sunAt(-11), moonDir: dirFromModelAzEl(200, 5), moonFraction: 0.3, date: '2026-12-24', minutes: 1200 },
      { sunDir: sunAt(-60), cloudPct: 100, date: '2026-06-01', minutes: 60 },
    ];
    for (const req of cases) {
      const r = computeSky(req);
      for (const img of [r.env, r.bg!]) {
        let bad = 0;
        for (let i = 0; i < img.data.length; i++) {
          const x = img.data[i];
          if (!(x >= 0) || !Number.isFinite(x)) bad++;
        }
        expect(bad).toBe(0);
      }
      expect(Number.isFinite(r.skyHorizontalLux)).toBe(true);
      expect(r.sun.colorLinear.every((c) => Number.isFinite(c) && c >= 0)).toBe(true);
    }
  });

  it('per-time compute stays interactive (LUTs once, then ~15 ms)', () => {
    computeSky({ sunDir: sunAt(30) }); // LUTs + JIT warm-up
    const times: number[] = [];
    let last = computeSky({ sunDir: sunAt(30) }).timings;
    for (let i = 0; i < 8; i++) {
      last = computeSky({ sunDir: sunAt(-3 + i * 0.4), date: '2026-09-20', minutes: 19 * 60 + 25 }).timings;
      times.push(last.total);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    console.log(`[sky] per-time compute: median ${median.toFixed(1)} ms, min ${times[0].toFixed(1)} ms; last`, last);
    // the budget is ~15 ms on a desktop core (measured 13–20 ms in a quiet
    // container); this bound only catches pathological regressions on
    // loaded CI machines running test files in parallel
    expect(median).toBeLessThan(300);
  });
});
