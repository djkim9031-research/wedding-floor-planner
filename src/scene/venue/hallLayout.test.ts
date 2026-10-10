import { describe, expect, it } from 'vitest';
import { BAY_X, COLUMNS, HALL_EAVE_Y, RIDGE_X, RIDGE_Y } from '../../constants';
import { GLULAM_D, RAFTER_D, roofY } from './geom';
import { GLULAM_BOT, GLULAM_TOP } from './hallShell';
import { RAFTER_SPACING, RAFTER_Z } from './hallRoof';
import { TRACK_PAIR_Z, trackHeads } from './hallFixtures';

describe('hall structure', () => {
  it('roof line runs from the wall-top line to the ridge', () => {
    expect(roofY(0)).toBeCloseTo(HALL_EAVE_Y);
    expect(roofY(545)).toBeCloseTo(HALL_EAVE_Y);
    expect(roofY(RIDGE_X)).toBeCloseTo(RIDGE_Y);
  });

  it('glulams sit right under the rafters and the posts reach them', () => {
    expect(GLULAM_TOP).toBeCloseTo(roofY(BAY_X[1]) - RAFTER_D);
    expect(GLULAM_TOP - GLULAM_BOT).toBeCloseTo(GLULAM_D);
    for (const c of COLUMNS) {
      expect(c.height).toBeCloseTo(GLULAM_BOT, 0);
      expect(c.size).toBeLessThanOrEqual(6);
    }
  });

  it('rafters land on both gable walls at a regular spacing', () => {
    expect(RAFTER_Z[0]).toBeCloseTo(-6);
    expect(RAFTER_Z).toContain(-6 + 10 * RAFTER_SPACING);
    expect(-6 + 10 * RAFTER_SPACING).toBeCloseTo(599);
  });
});

describe('track heads', () => {
  const heads = trackHeads();

  it('two per pair position on each glulam, unique ids', () => {
    expect(heads).toHaveLength(TRACK_PAIR_Z.length * 2 * 2);
    expect(new Set(heads.map((h) => h.id)).size).toBe(heads.length);
  });

  it('hang under the beams inside the hall and aim down onto the floor area', () => {
    for (const h of heads) {
      expect(h.lens.y).toBeLessThan(GLULAM_BOT);
      expect(h.lens.y).toBeGreaterThan(GLULAM_BOT - 12);
      expect(h.lens.x).toBeGreaterThan(0);
      expect(h.lens.x).toBeLessThan(545);
      expect(h.lens.z).toBeGreaterThan(0);
      expect(h.lens.z).toBeLessThan(599);
      expect(h.aim.y).toBeLessThan(h.lens.y - 100);
      expect(h.aim.x).toBeGreaterThan(0);
      expect(h.aim.x).toBeLessThan(545);
      // clear of the posts at z = 300
      expect(Math.abs(h.pivot.z - 300)).toBeGreaterThan(30);
    }
  });
});
