import { describe, expect, it } from 'vitest';
import { agxToImage } from './tonemap';

describe('agxToImage', () => {
  it('maps black to black and middle grey near sRGB ~0.46', () => {
    const src = new Float32Array([0, 0, 0, 1, 0.18, 0.18, 0.18, 1]);
    const out = agxToImage(src, 2, 1, 1);
    expect(out[0]).toBeLessThan(8);
    // AgX puts 18% grey a bit below the sRGB encode of 0.18 (≈118)
    expect(out[4]).toBeGreaterThan(90);
    expect(out[4]).toBeLessThan(135);
    expect(out[4]).toBe(out[5]);
  });
  it('flips GL rows to image rows', () => {
    const src = new Float32Array([10, 10, 10, 1, 0, 0, 0, 1]); // bottom row white, top black
    const out = agxToImage(src, 1, 2, 1);
    expect(out[0]).toBeLessThan(8); // top row first
    expect(out[4]).toBeGreaterThan(200);
  });
  it('rolls off highlights instead of clipping hue', () => {
    const out = agxToImage(new Float32Array([50, 5, 1, 1]), 1, 1, 1);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });
});
