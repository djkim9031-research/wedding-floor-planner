// --smoke-test=<png>: boot the real app, wait for window.__wpBooted, capture
// the window, report GPU status, exit 0 (non-zero on any failure). Used by
// .github/workflows/mac-app.yml against the packaged .app.
import { writeFileSync } from 'node:fs';
import { app, type BrowserWindow } from 'electron';

export const SMOKE_FLAG = '--smoke-test';
/** CI runners without a usable GPU (GitHub's hosted macOS VM) still prove
 * packaging: boot, app:// assets, the native bridge, weights, capture. */
export const ALLOW_NO_GPU_FLAG = '--smoke-allow-no-gpu';
export const BOOT_TIMEOUT_MS = 60_000;

/** `--smoke-test=/tmp/x.png` or `--smoke-test /tmp/x.png` → path; else null. */
export function smokeTarget(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(SMOKE_FLAG + '=')) return a.slice(SMOKE_FLAG.length + 1) || null;
    if (a === SMOKE_FLAG) {
      const next = argv[i + 1];
      return next && !next.startsWith('--') ? next : 'smoke.png';
    }
  }
  return null;
}

export function smokeAllowsNoGpu(argv: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes(ALLOW_NO_GPU_FLAG) || env.WP_SMOKE_ALLOW_NO_GPU === '1';
}

/** The app's own boot diagnostics name WebGL when the 3D view can't start. */
export function isNoGpuBootError(err: string | null | undefined): boolean {
  return !!err && /WebGL/i.test(err);
}

/** Luma spread of a BGRA bitmap — ~0 means a blank (single-colour) capture. */
export function lumaStdDev(bgra: Uint8Array, stride = 4, step = 7): number {
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i + 2 < bgra.length; i += stride * step) {
    const y = 0.0722 * bgra[i] + 0.7152 * bgra[i + 1] + 0.2126 * bgra[i + 2];
    sum += y;
    sum2 += y * y;
    n++;
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// runs in the page
const PAGE_PROBE = `(async () => {
  const out = { booted: window.__wpBooted === true, idle: window.__wpIdle === true, origin: location.origin,
    bootError: (document.getElementById('boot-error') || {}).textContent || null,
    webgl2: null, webgpu: { present: 'gpu' in navigator, adapter: null, error: null },
    oidnWeights: null, localStorage: null, native: typeof window.wpNative === 'object' };
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl2 = { renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    }
  } catch (e) { out.webgl2 = { error: String(e) }; }
  try {
    if (navigator.gpu) {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (ad) out.webgpu.adapter = { vendor: ad.info?.vendor, architecture: ad.info?.architecture,
        description: ad.info?.description, f16: ad.features.has('shader-f16') };
    }
  } catch (e) { out.webgpu.error = String(e); }
  try {
    const r = await fetch('oidn/rt_hdr_alb_nrm_small.tza');
    out.oidnWeights = { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
  } catch (e) { out.oidnWeights = { error: String(e) }; }
  try { localStorage.setItem('wp:smoke', '1'); out.localStorage = localStorage.getItem('wp:smoke') === '1'; localStorage.removeItem('wp:smoke'); }
  catch (e) { out.localStorage = String(e); }
  return out;
})()`;

export interface SmokeContext {
  win: BrowserWindow;
  png: string;
  log(msg: string): void;
  /** set by main when the page crashed / failed to load */
  fatal(): string | null;
  consoleErrors: string[];
  /** a WebGL-less boot passes as "degraded" once packaging checks hold */
  allowNoGpu?: boolean;
}

interface PageProbe {
  booted?: boolean;
  origin?: string;
  bootError?: string | null;
  webgl2?: { renderer?: string; error?: string } | null;
  oidnWeights?: { status?: number; error?: string } | null;
  localStorage?: boolean | string | null;
  native?: boolean;
}

/** What a GPU-less runner can still prove about the packaged app. */
export function packagingProblems(p: PageProbe | undefined): string[] {
  const out: string[] = [];
  if (!p) return ['no page probe'];
  if (p.origin !== 'app://planner') out.push(`origin is ${p.origin ?? 'unknown'}, expected app://planner`);
  if (p.native !== true) out.push('window.wpNative (preload bridge) is missing');
  if (p.oidnWeights?.status !== 200) out.push(`denoiser weights not served (${JSON.stringify(p.oidnWeights)})`);
  if (p.localStorage !== true) out.push(`localStorage unusable (${String(p.localStorage)})`);
  return out;
}

/** Returns the process exit code. */
export async function runSmoke(ctx: SmokeContext): Promise<number> {
  const { win, png } = ctx;
  const wc = win.webContents;
  const t0 = Date.now();
  const report: Record<string, unknown> = { png, electron: process.versions.electron, chrome: process.versions.chrome };
  const fail = (why: string): number => {
    report.ok = false;
    report.failure = why;
    report.consoleErrors = ctx.consoleErrors.slice(0, 20);
    console.log('WP_SMOKE ' + JSON.stringify(report));
    try {
      writeFileSync(png.replace(/\.png$/i, '') + '.json', JSON.stringify(report, null, 2));
    } catch {
      /* ignore */
    }
    return 1;
  };

  // boot
  let booted = false;
  let degraded: string | null = null;
  while (Date.now() - t0 < BOOT_TIMEOUT_MS) {
    const f = ctx.fatal();
    if (f) return fail(f);
    try {
      if (!wc.isLoading()) {
        const s = (await wc.executeJavaScript(
          `({ booted: window.__wpBooted === true, err: (document.getElementById('boot-error') || {}).textContent || null })`,
        )) as { booted: boolean; err: string | null };
        if (s.err) {
          if (ctx.allowNoGpu && isNoGpuBootError(s.err)) {
            degraded = 'no-gpu';
            report.bootError = s.err.trim();
            ctx.log('smoke: no WebGL on this machine — checking packaging only');
            break;
          }
          return fail('boot error: ' + s.err.trim());
        }
        if (s.booted) {
          booted = true;
          break;
        }
      }
    } catch {
      /* page not ready yet */
    }
    await sleep(250);
  }
  if (!booted && !degraded) return fail(`app did not boot within ${BOOT_TIMEOUT_MS / 1000}s`);
  report.bootMs = Date.now() - t0;
  report.degraded = degraded;
  if (booted) ctx.log(`smoke: booted in ${report.bootMs} ms`);

  if (booted) {
    // let the linens settle (non-fatal), then two more frames
    const tIdle = Date.now();
    while (Date.now() - tIdle < 20_000) {
      try {
        if (await wc.executeJavaScript('window.__wpIdle === true')) break;
      } catch {
        /* ignore */
      }
      await sleep(250);
    }
    await wc.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))').catch(() => undefined);
    await sleep(500);
  }

  try {
    report.page = await wc.executeJavaScript(PAGE_PROBE);
  } catch (e) {
    report.page = { error: String(e) };
  }
  report.gpuFeatureStatus = app.getGPUFeatureStatus();
  try {
    report.gpuInfo = await app.getGPUInfo('basic');
  } catch (e) {
    report.gpuInfo = String(e);
  }

  const page = report.page as PageProbe | undefined;
  report.webgl = !!page?.webgl2?.renderer;

  const img = await wc.capturePage();
  if (img.isEmpty()) {
    if (!degraded) return fail('capturePage returned an empty image');
    report.capture = null;
  } else {
    const size = img.getSize();
    writeFileSync(png, img.toPNG());
    const spread = lumaStdDev(img.toBitmap());
    report.capture = { ...size, lumaStdDev: Math.round(spread * 10) / 10 };
    if (spread < 1 && !degraded) return fail('captured window is blank');
  }

  const f = ctx.fatal();
  if (f) return fail(f);
  if (degraded) {
    const problems = packagingProblems(page);
    if (problems.length) return fail(`no GPU, and packaging checks failed: ${problems.join('; ')}`);
  }
  report.ok = true;
  report.totalMs = Date.now() - t0;
  report.consoleErrors = ctx.consoleErrors.slice(0, 20);
  console.log('WP_SMOKE ' + JSON.stringify(report));
  writeFileSync(png.replace(/\.png$/i, '') + '.json', JSON.stringify(report, null, 2));
  return 0;
}
