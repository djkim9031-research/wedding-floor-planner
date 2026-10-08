import { describe, expect, it } from 'vitest';
import { DECK_PLANTER_REACH, DECK_PLANTER_SPOTS, ITEM_DIMS, PRESETS, isLounge } from '../constants';
import type { PlacedItem } from '../types';
import { aabbToOBB, obbFromPose, obbIntersectsOBB } from './geometry';
import { isPoseValid } from './validity';

describe('built-in layouts', () => {
  for (const preset of PRESETS) {
    it(`every item in "${preset.name}" is a valid placement`, () => {
      const items = preset.items.map((it, i) => ({ id: `p${i}`, ...it }) as PlacedItem);
      // linens drape over anything, and isPoseValid sizes them by the catalog
      // default rather than a custom linen's dims
      const bad = items.filter((it) => !it.type.startsWith('cloth') && !isPoseValid(it.type, { x: it.x, z: it.z, yawDeg: it.yawDeg }, items, it.id));
      expect(bad.map((it) => `${it.type}@${it.x.toFixed(1)},${it.z.toFixed(1)}`)).toEqual([]);
    });
  }

  it('nothing in the built-in layouts stands on a deck planter', () => {
    for (const preset of PRESETS) {
      for (const it of preset.items) {
        if (it.type.startsWith('cloth')) continue;
        const d = ITEM_DIMS[it.type];
        const a = (it.yawDeg * Math.PI) / 180;
        for (const [px, pz] of DECK_PLANTER_SPOTS) {
          // planter centre in the item's frame, then distance to its footprint
          const dx = px - it.x;
          const dz = pz - it.z;
          const lx = dx * Math.cos(a) - dz * Math.sin(a);
          const lz = dx * Math.sin(a) + dz * Math.cos(a);
          const gap = Math.hypot(Math.max(Math.abs(lx) - d.w / 2, 0), Math.max(Math.abs(lz) - d.d / 2, 0));
          expect(gap, `${preset.name}: ${it.type}@${it.x},${it.z}`).toBeGreaterThan(DECK_PLANTER_REACH + 2);
        }
      }
    }
  });

  it('the wedding ceremony seats 8 facing the couple from the railing side', () => {
    const items = PRESETS.find((p) => p.name === 'Wedding layout')!.items;
    const couple = items.filter((it) => it.type === 'figureM' || it.type === 'figureW');
    const cz = couple.reduce((s, it) => s + it.z, 0) / couple.length;
    const cx = couple.reduce((s, it) => s + it.x, 0) / couple.length;
    // the couple faces north (−z), toward the deck railing
    for (const f of couple) expect(f.yawDeg).toBe(180);
    const guests = items.filter((it) => it.type === 'chair' && !it.set && it.z < 0);
    expect(guests).toHaveLength(8);
    for (const c of guests) {
      // north of the couple, and turned toward them (forward = (sin yaw, cos yaw));
      // straight rows sit up to ~30° off the line to the couple at their ends
      expect(c.z).toBeLessThan(cz);
      const yaw = (c.yawDeg * Math.PI) / 180;
      const toCouple = Math.atan2(cx - c.x, cz - c.z);
      const diff = Math.abs(Math.atan2(Math.sin(toCouple - yaw), Math.cos(toCouple - yaw)));
      expect(diff).toBeLessThan((40 * Math.PI) / 180);
    }
  });

  it('the cocktail lounge outside the entry: 4 tables pushed together with tiny gaps, 8 lounge seats', () => {
    const items = PRESETS.find((p) => p.name === 'Wedding layout')!.items;
    const tables = items.filter((it) => it.type === 'tableCoffee');
    expect(tables).toHaveLength(4);
    const { w, d } = ITEM_DIMS.tableCoffee;
    const xs = [...new Set(tables.map((it) => it.x))].sort((a, b) => a - b);
    const zs = [...new Set(tables.map((it) => it.z))].sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(zs).toHaveLength(2);
    // separate tables, pushed together: a small visible gap (2–3"), never touching
    for (const gap of [xs[1] - xs[0] - w, zs[1] - zs[0] - d]) {
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(3);
    }
    const sofas = items.filter((it) => it.type === 'loungeSofa');
    const chairs = items.filter((it) => it.type === 'loungeChair');
    // one sofa (east) + 5 chairs: the couple took out the west sofa
    expect(sofas.length * 3 + chairs.length).toBe(8);
    // everyone faces the tables across 12–18" of legroom: the nearest table
    // edge ahead of each seat (forward = (sin yaw, cos yaw))
    const bx = [xs[0] - w / 2, xs[1] + w / 2];
    const bz = [zs[0] - d / 2, zs[1] + d / 2];
    for (const s of [...sofas, ...chairs]) {
      const a = (s.yawDeg * Math.PI) / 180;
      const ahead = (x: number, z: number) => x * Math.sin(a) + z * Math.cos(a);
      const knee = Math.min(...bx.flatMap((x) => bz.map((z) => ahead(x, z)))) - ahead(s.x, s.z) - ITEM_DIMS[s.type].d / 2;
      expect(knee, `${s.type}@${s.x},${s.z}`).toBeGreaterThanOrEqual(12);
      expect(knee, `${s.type}@${s.x},${s.z}`).toBeLessThanOrEqual(18);
    }
    // outside the entry (south of the vestibule doors), 6' further right
    // (east) than first drawn around (354, 790), as the couple asked: over the
    // walk's east post line onto the terrace
    expect((xs[0] + xs[1]) / 2).toBeCloseTo(354 + 72);
    expect((zs[0] + zs[1]) / 2).toBeCloseTo(790);
    for (const it of [...tables, ...sofas, ...chairs]) {
      expect(it.z).toBeGreaterThan(662);
      expect(it.x).toBeGreaterThan(340);
    }
  });

  it('the entry doors keep a clear approach: no lounge piece within 10 ft of them', () => {
    // the two glass leaves span x 236.5–308 on the vestibule's south face
    // (z 662); keep 10" either side of them clear for 10' south of the glass
    const approach = aabbToOBB((226 + 318) / 2, (662 + 782) / 2, 318 - 226, 782 - 662);
    for (const preset of PRESETS) {
      for (const it of preset.items) {
        if (it.type !== 'tableCoffee' && !isLounge(it.type)) continue;
        expect(obbIntersectsOBB(obbFromPose(it, ITEM_DIMS[it.type]), approach), `${preset.name}: ${it.type}@${it.x},${it.z}`).toBe(false);
      }
    }
  });
});
