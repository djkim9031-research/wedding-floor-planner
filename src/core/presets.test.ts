import { describe, expect, it } from 'vitest';
import { PRESETS } from '../constants';
import type { PlacedItem } from '../types';
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
});
