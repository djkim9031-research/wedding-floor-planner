/** Deterministic PRNG + seeding — the sim must never touch Math.random(). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string; used to fold the item type into the seed. */
function fnv1a(str: string, h = 0x811c9dc5): number {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed keyed on the quantized pose so re-placing the same cloth in the same
 * spot reproduces the same drop (quarter-inch / whole-degree buckets). */
export function poseSeed(type: string, x: number, z: number, yawDeg: number): number {
  let h = fnv1a(type);
  h = Math.imul(h ^ Math.round(x * 4), 0x01000193) >>> 0;
  h = Math.imul(h ^ Math.round(z * 4), 0x01000193) >>> 0;
  h = Math.imul(h ^ Math.round(yawDeg), 0x01000193) >>> 0;
  return h >>> 0;
}
