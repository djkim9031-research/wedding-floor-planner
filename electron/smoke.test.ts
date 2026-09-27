import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));
const { lumaStdDev, smokeTarget } = await import('./smoke');

describe('smokeTarget', () => {
  it('parses both flag forms', () => {
    expect(smokeTarget(['/x/Wedding Venue Studio', '--smoke-test=/tmp/s.png'])).toBe('/tmp/s.png');
    expect(smokeTarget(['electron', '.', '--smoke-test', 'out.png'])).toBe('out.png');
    expect(smokeTarget(['electron', '.', '--smoke-test', '--other'])).toBe('smoke.png');
    expect(smokeTarget(['electron', '.'])).toBeNull();
    expect(smokeTarget(['--smoke-test='])).toBeNull();
  });
});

describe('lumaStdDev', () => {
  it('is ~0 for a flat image and large for a varied one', () => {
    const flat = new Uint8Array(4 * 1000).fill(128);
    expect(lumaStdDev(flat)).toBeLessThan(0.01);
    const varied = new Uint8Array(4 * 1000);
    for (let i = 0; i < varied.length; i++) varied[i] = (i * 37) % 256;
    expect(lumaStdDev(varied)).toBeGreaterThan(10);
    expect(lumaStdDev(new Uint8Array(0))).toBe(0);
  });
});
