import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getGPUFeatureStatus: () => ({ webgl2: 'unavailable_software' }), getGPUInfo: async () => ({ gpuDevice: [] }) },
}));
const { isNoGpuBootError, lumaStdDev, packagingProblems, runSmoke, smokeAllowsNoGpu, smokeTarget } = await import('./smoke');

describe('smokeTarget', () => {
  it('parses both flag forms', () => {
    expect(smokeTarget(['/x/Wedding Venue Studio', '--smoke-test=/tmp/s.png'])).toBe('/tmp/s.png');
    expect(smokeTarget(['electron', '.', '--smoke-test', 'out.png'])).toBe('out.png');
    expect(smokeTarget(['electron', '.', '--smoke-test', '--other'])).toBe('smoke.png');
    expect(smokeTarget(['electron', '.'])).toBeNull();
    expect(smokeTarget(['--smoke-test='])).toBeNull();
  });
  it('reads the no-GPU allowance from the flag or the environment', () => {
    expect(smokeAllowsNoGpu(['--smoke-test=a.png', '--smoke-allow-no-gpu'], {})).toBe(true);
    expect(smokeAllowsNoGpu(['--smoke-test=a.png'], { WP_SMOKE_ALLOW_NO_GPU: '1' })).toBe(true);
    expect(smokeAllowsNoGpu(['--smoke-test=a.png'], {})).toBe(false);
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

describe('no-GPU boot', () => {
  it('recognises the app diagnostics for a missing WebGL context', () => {
    expect(isNoGpuBootError('The 3D planner could not start.\n• Uncaught Error: THREE.WebGLRenderer: Error creating WebGL context.')).toBe(true);
    expect(isNoGpuBootError('• WebGL2 is not available in this browser')).toBe(true);
    expect(isNoGpuBootError('• unhandled: TypeError: x is not a function')).toBe(false);
    expect(isNoGpuBootError(null)).toBe(false);
  });
  it('lists what a GPU-less runner failed to prove', () => {
    expect(packagingProblems({ origin: 'app://planner', native: true, oidnWeights: { status: 200 }, localStorage: true })).toEqual([]);
    const p = packagingProblems({ origin: 'file://', native: false, oidnWeights: { status: 404 }, localStorage: 'SecurityError' });
    expect(p).toHaveLength(4);
    expect(packagingProblems(undefined)).toEqual(['no page probe']);
  });
});

describe('runSmoke', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wp-smoke-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const NO_GPU = 'The 3D planner could not start.\n\n• Uncaught Error: THREE.WebGLRenderer: Error creating WebGL context.';
  const probe = { origin: 'app://planner', native: true, oidnWeights: { status: 200 }, localStorage: true, webgl2: null };
  const bitmap = new Uint8Array(4 * 4096);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = (i * 53) % 251;

  const fakeWin = (page: Record<string, unknown>, bootErr: string | null) =>
    ({
      webContents: {
        isLoading: () => false,
        executeJavaScript: async (code: string) => {
          if (code.trim().startsWith('({ booted')) return { booted: false, err: bootErr };
          if (code === 'window.__wpIdle === true') return true;
          if (code.startsWith('new Promise')) return undefined;
          return page;
        },
        capturePage: async () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 800, height: 600 }),
          toPNG: () => Buffer.from('PNG'),
          toBitmap: () => bitmap,
        }),
      },
    }) as unknown as Parameters<typeof runSmoke>[0]['win'];
  const logs: string[] = [];
  const ctx = (win: ReturnType<typeof fakeWin>, png: string, allowNoGpu: boolean) => ({
    win,
    png,
    log: (m: string) => logs.push(m),
    fatal: () => null,
    consoleErrors: [],
    allowNoGpu,
  });

  it('passes a WebGL-less boot as degraded when allowed and packaging holds', async () => {
    const png = join(tmp, 'a.png');
    const code = await runSmoke(ctx(fakeWin(probe, NO_GPU), png, true));
    expect(code).toBe(0);
    const report = JSON.parse(readFileSync(join(tmp, 'a.json'), 'utf8'));
    expect(report).toMatchObject({ ok: true, degraded: 'no-gpu', webgl: false, capture: { width: 800 } });
    expect(readFileSync(png, 'utf8')).toBe('PNG');
  });

  it('still fails a WebGL-less boot without the allowance', async () => {
    const code = await runSmoke(ctx(fakeWin(probe, NO_GPU), join(tmp, 'b.png'), false));
    expect(code).toBe(1);
    expect(JSON.parse(readFileSync(join(tmp, 'b.json'), 'utf8')).failure).toMatch(/boot error/);
  });

  it('fails a degraded boot when the packaging checks do not hold', async () => {
    const code = await runSmoke(ctx(fakeWin({ ...probe, native: false }, NO_GPU), join(tmp, 'c.png'), true));
    expect(code).toBe(1);
    expect(JSON.parse(readFileSync(join(tmp, 'c.json'), 'utf8')).failure).toMatch(/wpNative/);
  });

  it('does not let the allowance mask a real script error', async () => {
    const code = await runSmoke(ctx(fakeWin(probe, '• unhandled: TypeError: boom'), join(tmp, 'd.png'), true));
    expect(code).toBe(1);
  });
});
