import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUMP_REF_TEXELS_PER_PIXEL, bumpScaleToStrength, heightsFromTexture, normalFromHeight, normalMapFromBump } from './normalFromHeight';

const px = (out: Uint8Array, w: number, x: number, y: number) => {
  const o = (y * w + x) * 4;
  return [out[o], out[o + 1], out[o + 2], out[o + 3]];
};
const dec = (v: number) => (v / 255) * 2 - 1;

describe('normalFromHeight', () => {
  it('flat height → (128,128,255)', () => {
    const w = 8;
    const h = 4;
    const out = normalFromHeight(new Float32Array(w * h).fill(0.5), w, h, 3);
    expect(out.length).toBe(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(px(out, w, x, y)).toEqual([128, 128, 255, 255]);
  });

  it('x-ramp → constant tilt toward −U (R < 128), no V tilt', () => {
    const w = 16;
    const h = 5;
    const hs = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hs[y * w + x] = x * 0.05;
    const s = 4;
    const out = normalFromHeight(hs, w, h, s, { wrapX: false, wrapY: false });
    const ref = px(out, w, 0, 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(px(out, w, x, y)).toEqual(ref);
    expect(ref[0]).toBeLessThan(128);
    expect(ref[1]).toBe(128);
    // magnitude: n = normalize(−s·0.05, 0, 1)
    const nx = -s * 0.05;
    const len = Math.hypot(nx, 1);
    expect(dec(ref[0])).toBeCloseTo(nx / len, 1);
    expect(dec(ref[2])).toBeCloseTo(1 / len, 1);
  });

  it('+V orientation: height rising with row index tilts G below 128', () => {
    const w = 4;
    const h = 12;
    const hs = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hs[y * w + x] = y * 0.05;
    const out = normalFromHeight(hs, w, h, 2, { wrapX: false, wrapY: false });
    for (let y = 0; y < h; y++) {
      const p = px(out, w, 2, y);
      expect(p[0]).toBe(128);
      expect(p[1]).toBeLessThan(128);
    }
  });

  it('wraps continuously across the seam (rolled input → rolled output)', () => {
    const w = 32;
    const h = 8;
    const hs = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) hs[y * w + x] = 0.5 + 0.4 * Math.sin((2 * Math.PI * x) / w) * Math.cos((2 * Math.PI * y) / h);
    const k = 7;
    const rolled = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rolled[y * w + ((x + k) % w)] = hs[y * w + x];
    const a = normalFromHeight(hs, w, h, 5);
    const b = normalFromHeight(rolled, w, h, 5);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(px(b, w, (x + k) % w, y)).toEqual(px(a, w, x, y));
    // at x = 0 the slope of sin is +max → R well below 128 (no seam flattening)
    expect(px(a, w, 0, 0)[0]).toBeLessThan(100);
  });

  it('strength scales the tilt; bumpScale maps 1:1', () => {
    const w = 8;
    const h = 1;
    const hs = new Float32Array(w).map((_, x) => x * 0.1);
    const weak = px(normalFromHeight(hs, w, h, 0.5, { wrapX: false }), w, 3, 0)[0];
    const strong = px(normalFromHeight(hs, w, h, 5, { wrapX: false }), w, 3, 0)[0];
    expect(strong).toBeLessThan(weak);
    expect(bumpScaleToStrength(0.6)).toBeCloseTo(0.6 * BUMP_REF_TEXELS_PER_PIXEL);
  });
});

describe('normalMapFromBump', () => {
  it('keeps the bump transform and reuses baked pixels per source', () => {
    const w = 4;
    const h = 4;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4] = (i % w) * 60;
    const bump = new THREE.DataTexture(data, w, h);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(3, 2);
    bump.offset.set(0.25, 0);
    const a = normalMapFromBump(bump, 1)!;
    const b = normalMapFromBump(bump, 1)!;
    const c = normalMapFromBump(bump, 2)!;
    expect(a).not.toBe(b);
    expect(a.source).toBe(b.source); // baked once
    expect((b as THREE.DataTexture).isDataTexture).toBe(true); // uploadable raw data
    expect(c.source).not.toBe(a.source);
    expect(a.repeat.toArray()).toEqual([3, 2]);
    expect(a.offset.toArray()).toEqual([0.25, 0]);
    expect([a.wrapS, a.wrapT, a.flipY, a.colorSpace]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping, false, THREE.NoColorSpace]);
    const img = a.image as { data: Uint8Array; width: number };
    expect(img.width).toBe(4);
    expect(img.data[4 + 0]).toBeLessThan(128); // x-ramp tilts toward −U
  });
});

describe('heightsFromTexture', () => {
  it('reverses rows for flipY images, keeps data textures as-is', () => {
    const w = 2;
    const h = 3;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[(y * w + x) * 4] = y * 100; // image row y
    const dt = new THREE.DataTexture(data, w, h);
    const a = heightsFromTexture(dt)!;
    expect(a.heights[0]).toBeCloseTo(0);
    expect(a.heights[2 * w]).toBeCloseTo(200 / 255);

    const t = new THREE.Texture({ data, width: w, height: h });
    t.flipY = true; // image top row lands at v = 1
    const b = heightsFromTexture(t)!;
    expect(b.heights[0]).toBeCloseTo(200 / 255); // row 0 (v 0) = image bottom
    expect(b.heights[2 * w]).toBeCloseTo(0);
  });
});
