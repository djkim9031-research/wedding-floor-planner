import { describe, expect, it } from 'vitest';
import { DECK_TRUNKS, IN } from '../constants';
import { DECK_TOP_Y, deckOakSpec } from './exterior';
import { COAST_LIVE_OAK, TreeBatch, autoTree, farVariant } from './oak';

function build(seed = 0xdec0a): TreeBatch {
  const b = new TreeBatch(COAST_LIVE_OAK, true);
  b.add(deckOakSpec(), seed);
  return b;
}

describe('tree generator', () => {
  it('is deterministic for a seed', () => {
    const a = build();
    const b = build();
    expect(a.stats).toEqual(b.stats);
    expect(a.leavesRender.pos.length).toBe(b.leavesRender.pos.length);
    expect(a.bark.pos.slice(0, 300)).toEqual(b.bark.pos.slice(0, 300));
  });

  it('deck oak stays inside its leaf-card budgets', () => {
    const t = build();
    const liveCards = t.leavesLive.triangles / 2;
    const renderCards = t.leavesRender.triangles / 2;
    expect(liveCards).toBeGreaterThan(6000);
    expect(liveCards).toBeLessThan(10000);
    expect(renderCards).toBeGreaterThan(40000);
    expect(renderCards).toBeLessThan(60000);
    const liveTris = t.bark.triangles + t.barkFine.triangles + t.leavesLive.triangles;
    expect(liveTris).toBeLessThan(100000);
  });

  it('trunks pass through their scribed deck openings without touching the boards', () => {
    const t = build();
    const pos = t.bark.pos;
    let checked = 0;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k] / IN;
      const y = pos[k + 1] / IN;
      const z = pos[k + 2] / IN;
      if (Math.abs(y - DECK_TOP_Y) > 3) continue; // rings are ~5" apart
      const near = DECK_TRUNKS.filter((f) => Math.hypot(x - f.x, z - f.z) < 40);
      if (!near.length) continue;
      // every trunk vertex at deck level lies inside one of the openings
      const inside = near.some((f) => {
        const a = (f.rotDeg * Math.PI) / 180;
        const dx = x - f.x;
        const dz = z - f.z;
        const lx = dx * Math.cos(a) - dz * Math.sin(a);
        const lz = dx * Math.sin(a) + dz * Math.cos(a);
        return (lx / f.rx) ** 2 + (lz / f.rz) ** 2 < 1;
      });
      expect(inside).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('far variants are cheap', () => {
    const b = new TreeBatch(farVariant(COAST_LIVE_OAK));
    b.add(autoTree(COAST_LIVE_OAK, { x: 0, z: 0, y: 0, height: 450, spread: 300, seed: 7 }), 7);
    expect(b.bark.triangles + b.leavesLive.triangles).toBeLessThan(4000);
  });
});
