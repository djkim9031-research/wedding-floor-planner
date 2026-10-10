import { describe, expect, it } from 'vitest';
import { exposureScale } from './exposure';
import { getSky, getSkyInput, SHOWCASE_INPUT, setSkyInput, subscribeSky } from './skyStore';

describe('sky store (physical model registered)', () => {
  it('returns physical daylight for a September noon at the venue', () => {
    setSkyInput({ enabled: true, date: '2026-09-20', minutes: 13 * 60, cloudPct: 0, evComp: 0, autoEV: true });
    const s = getSky();
    expect(s.phase).toBe('day');
    expect(s.sun.altDeg).toBeGreaterThan(50);
    expect(s.sun.illuminanceLux).toBeGreaterThan(90000);
    expect(s.skyHorizontalLux).toBeGreaterThan(5000);
    expect([s.env.w, s.env.h, s.bg.w, s.bg.h]).toEqual([512, 256, 1024, 512]);
    expect(s.ev100).toBeGreaterThan(13.5);
    expect(s.ev100).toBeLessThan(15.8);
  });

  it('+1 EV compensation brightens by exactly one stop', () => {
    setSkyInput({ date: '2026-09-20', minutes: 17 * 60, evComp: 0 });
    const a = getSky().ev100;
    setSkyInput({ evComp: 1 });
    const b = getSky().ev100;
    expect(a - b).toBeCloseTo(1, 9);
    expect(exposureScale(b) / exposureScale(a)).toBeCloseTo(2, 9);
    setSkyInput({ evComp: 0 });
  });

  it('auto EV (metered) reads brighter than the sky preset at dusk', () => {
    setSkyInput({ date: '2026-09-20', minutes: 19 * 60 + 25, autoEV: false });
    const preset = getSky().ev100;
    setSkyInput({ autoEV: true });
    const auto = getSky().ev100;
    expect(auto).toBeLessThan(preset);
    expect(getSky().phase).toBe('civil');
  });

  it('dusk sun is gone, the western ridge hides it before geometric sunset', () => {
    setSkyInput({ date: '2026-09-20', minutes: 19 * 60 + 25 });
    expect(getSky().sun.illuminanceLux).toBe(0);
    setSkyInput({ minutes: 19 * 60 + 2 }); // alt ≈ 1°, behind the ~2° ridge
    const s = getSky();
    expect(s.sun.altDeg).toBeGreaterThan(0);
    expect(s.sun.ridgeVisibility).toBeLessThan(0.5);
    expect(s.sun.illuminanceLux).toBeLessThan(0.5 * 5000);
  });

  it('clouds damp the direct sun and flatten the sky', () => {
    setSkyInput({ date: '2026-09-20', minutes: 13 * 60, cloudPct: 100 });
    const s = getSky();
    expect(s.sun.illuminanceLux).toBe(0);
    expect(s.skyHorizontalLux).toBeGreaterThan(20000);
    setSkyInput({ cloudPct: 0 });
  });

  it('showcase (disabled) uses the fixed preset, keeping comp/auto', () => {
    setSkyInput({ enabled: false, evComp: 0.5 });
    const s = getSky();
    expect(s.input.enabled).toBe(false);
    expect(getSkyInput().evComp).toBe(0.5);
    // Oct 11 16:30 → sun ~20° up in the WSW
    expect(s.sun.altDeg).toBeGreaterThan(10);
    expect(s.sun.altDeg).toBeLessThan(30);
    expect(SHOWCASE_INPUT.date).toBe('2026-10-11');
    setSkyInput({ enabled: true, evComp: 0 });
  });

  it('notifies subscribers with a new version on every change', () => {
    const seen: number[] = [];
    const off = subscribeSky((s) => seen.push(s.version));
    setSkyInput({ minutes: 12 * 60 });
    setSkyInput({ minutes: 12 * 60 + 5 });
    off();
    setSkyInput({ minutes: 12 * 60 + 10 });
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeGreaterThan(seen[0]);
  });
});
