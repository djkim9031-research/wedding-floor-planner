import { describe, expect, it } from 'vitest';
import { BREEZEWAY_POSTS, DECK_POLY, DECK_TRUNKS, ITEM_DIMS } from '../constants';
import { obbCorners, obbFromPose, pointInPolygon } from './geometry';
import { isPoseValid, obbOverlapsEllipse } from './validity';

const A = DECK_TRUNKS[0];

describe('deck trunk openings', () => {
  it('every trunk opening lies inside the deck and they do not touch', () => {
    for (const t of DECK_TRUNKS) {
      for (const [dx, dz] of [
        [t.rx, 0],
        [-t.rx, 0],
        [0, t.rz],
        [0, -t.rz],
      ]) {
        expect(pointInPolygon({ x: t.x + dx, z: t.z + dz }, DECK_POLY)).toBe(true);
      }
    }
    for (let i = 0; i < DECK_TRUNKS.length; i++) {
      for (let j = i + 1; j < DECK_TRUNKS.length; j++) {
        const a = DECK_TRUNKS[i];
        const b = DECK_TRUNKS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(Math.max(a.rx, a.rz) + Math.max(b.rx, b.rz));
      }
    }
  });

  it('ellipse test: centred box overlaps, far box does not, touching box is fine', () => {
    const corners = (x: number, z: number, w: number, d: number, yaw = 0) => obbCorners(obbFromPose({ x, z, yawDeg: yaw }, { w, d }));
    expect(obbOverlapsEllipse(corners(A.x, A.z, 10, 10), A)).toBe(true); // inside
    expect(obbOverlapsEllipse(corners(A.x, A.z, 200, 200), A)).toBe(true); // swallows it
    expect(obbOverlapsEllipse(corners(A.x + A.rx + 30, A.z, 40, 20), A)).toBe(false);
    // flush against the +x vertex of an unrotated ellipse
    const e = { x: 0, z: 0, rx: 20, rz: 10, rotDeg: 0 };
    expect(obbOverlapsEllipse(corners(20 + 5, 0, 10, 10), e, 0.05)).toBe(false);
    expect(obbOverlapsEllipse(corners(20 + 4, 0, 10, 10), e, 0.05)).toBe(true);
    // a rotated ellipse: 90° swaps the axes
    const r = { ...e, rotDeg: 90 };
    expect(obbOverlapsEllipse(corners(0, 24, 10, 10), r, 0.05)).toBe(true);
    expect(obbOverlapsEllipse(corners(24, 0, 10, 10), r, 0.05)).toBe(false);
  });

  it('placement: tables and planters cannot sit on a trunk; figures can', () => {
    expect(isPoseValid('table', { x: A.x, z: A.z, yawDeg: 0 }, [])).toBe(false);
    expect(isPoseValid('tableSq', { x: A.x + A.rx + ITEM_DIMS.tableSq.w / 2 - 2, z: A.z, yawDeg: 0 }, [])).toBe(false);
    expect(isPoseValid('tableSq', { x: A.x - A.rx - ITEM_DIMS.tableSq.w / 2 - 1, z: A.z, yawDeg: 0 }, [])).toBe(true);
    expect(isPoseValid('chair', { x: A.x, z: A.z + A.rz + 3, yawDeg: 0 }, [])).toBe(false);
    expect(isPoseValid('figureM', { x: A.x, z: A.z, yawDeg: 0 }, [])).toBe(true);
  });

  it('the #demo=deck layout stays valid', () => {
    const demo: [Parameters<typeof isPoseValid>[0], number, number, number][] = [
      ['table', 200, -160, 40],
      ['tableSq', 420, -220, 10],
      ['chair', 455, -185, 190],
    ];
    for (const [type, x, z, yawDeg] of demo) expect(isPoseValid(type, { x, z, yawDeg }, [])).toBe(true);
  });
});

describe('entry breezeway walk', () => {
  it('takes items on the walk outside the entry, but not on its posts', () => {
    expect(isPoseValid('tableCoffee', { x: 305, z: 705, yawDeg: 0 }, [])).toBe(true);
    const post = BREEZEWAY_POSTS.find((p) => p.x === 395)!;
    expect(isPoseValid('tableCoffee', { x: post.x, z: post.z, yawDeg: 0 }, [])).toBe(false);
    // straddling the vestibule doors (half in the hall, half on the walk)
    expect(isPoseValid('tableCoffee', { x: 300, z: 662, yawDeg: 0 }, [])).toBe(false);
  });

  it('takes items on the paved terrace east of the walk, but not past it', () => {
    // on the terrace (x 469–560, z 662–890), and across its seam with the walk
    expect(isPoseValid('loungeSofa', { x: 520, z: 780, yawDeg: 270 }, [])).toBe(true);
    expect(isPoseValid('loungeSofa', { x: 469, z: 780, yawDeg: 270 }, [])).toBe(true);
    // over its east or south edge, or south of it beside the walk (court bed)
    expect(isPoseValid('tableCoffee', { x: 560, z: 780, yawDeg: 0 }, [])).toBe(false);
    expect(isPoseValid('tableCoffee', { x: 520, z: 890, yawDeg: 0 }, [])).toBe(false);
    expect(isPoseValid('tableCoffee', { x: 520, z: 950, yawDeg: 0 }, [])).toBe(false);
  });
});
