// Drives electron/main.ts against a fake `electron` module: GPU switches,
// app:// serving, window options, IPC trust + handlers, and the smoke flow.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  return {
    /** temp dir, set in beforeAll before the fake electron module is built */
    root: '',
    switches: new Map<string, string>(),
    schemes: [] as unknown[],
    protocolHandler: null as null | ((r: Request) => Promise<Response>),
    ipc: new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>(),
    windows: [] as Array<{ opts: Record<string, unknown>; loaded: string[]; wc: Record<string, unknown> }>,
    menu: null as unknown,
    exitCode: null as number | null,
    appEvents: new Map<string, (...a: unknown[]) => void>(),
    ready: null as null | (() => void),
    page: { booted: true },
  };
});

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const bitmap = new Uint8Array(4 * 4096);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = (i * 53) % 251;
  class WebContents extends EE {
    send = vi.fn();
    insertCSS = vi.fn(async () => 'css-key');
    removeInsertedCSS = vi.fn(async () => undefined);
    setWindowOpenHandler = vi.fn();
    isLoading = (): boolean => false;
    executeJavaScript = vi.fn(async (code: string) => {
      if (code.includes('booted: window.__wpBooted')) return { booted: h.page.booted, err: null };
      if (code.includes('__wpIdle')) return true;
      if (code.includes('requestAnimationFrame')) return undefined;
      return { booted: true, webgl2: { renderer: 'fake' }, oidnWeights: { status: 200 } };
    });
    capturePage = vi.fn(async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 1440, height: 900 }),
      toPNG: () => Buffer.from('PNGDATA'),
      toBitmap: () => bitmap,
    }));
  }
  class BrowserWindow extends EE {
    static fromWebContents = (): null => null;
    webContents = new WebContents();
    loaded: string[] = [];
    constructor(public opts: Record<string, unknown>) {
      super();
      h.windows.push({ opts, loaded: this.loaded, wc: this.webContents as unknown as Record<string, unknown> });
    }
    loadURL = vi.fn(async (u: string) => {
      this.loaded.push(u);
    });
    show = vi.fn();
    isDestroyed = (): boolean => false;
    isFullScreen = (): boolean => false;
    isMaximized = (): boolean => false;
    getNormalBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
    maximize = vi.fn();
    setFullScreen = vi.fn();
  }
  const paths: Record<string, string> = {
    appData: join(h.root, 'appData'),
    documents: join(h.root, 'docs'),
  };
  const readyPromise = new Promise<void>((r) => (h.ready = r));
  const app = {
    setName: vi.fn(),
    setPath: (k: string, v: string) => (paths[k] = v),
    getPath: (k: string) => paths[k] ?? join(h.root, k),
    setAppLogsPath: () => (paths.logs = join(h.root, 'logs')),
    commandLine: {
      appendSwitch: (k: string, v = '') => h.switches.set(k, v),
      hasSwitch: (k: string) => h.switches.has(k),
      getSwitchValue: (k: string) => h.switches.get(k) ?? '',
    },
    getAppPath: () => join(h.root, 'app'),
    isPackaged: false,
    getVersion: () => '1.2.3',
    requestSingleInstanceLock: () => true,
    on: (ev: string, fn: (...a: unknown[]) => void) => h.appEvents.set(ev, fn),
    whenReady: () => readyPromise,
    isReady: () => true,
    setAboutPanelOptions: vi.fn(),
    getGPUFeatureStatus: () => ({ webgl2: 'enabled', webgpu: 'enabled' }),
    getGPUInfo: async () => ({ gpuDevice: [] }),
    relaunch: vi.fn(),
    quit: vi.fn(),
    exit: (c: number) => {
      h.exitCode = c;
    },
  };
  return {
    app,
    BrowserWindow,
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBoxSync: vi.fn() },
    ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => h.ipc.set(ch, fn) },
    protocol: {
      registerSchemesAsPrivileged: (s: unknown[]) => h.schemes.push(...s),
      handle: (_s: string, fn: (r: Request) => Promise<Response>) => (h.protocolHandler = fn),
    },
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1536, height: 935 } }],
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1536, height: 935 } }),
    },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
    shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
    Menu: { setApplicationMenu: (m: unknown) => (h.menu = m), buildFromTemplate: (t: unknown) => ({ template: t }) },
  };
});

const trusted = { senderFrame: { url: 'app://planner/index.html' }, sender: {} };
const untrusted = { senderFrame: { url: 'https://evil.example.com/' }, sender: {} };
const ipc = (ch: string, e: unknown, ...a: unknown[]) => h.ipc.get(ch)!(e, ...a) as Promise<{ ok: boolean; value?: unknown; error?: string }>;
const get = (url: string, method = 'GET') => h.protocolHandler!(new Request(url, { method }));

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wp-main-'));
  h.root = tmp;
  mkdirSync(join(tmp, 'app', 'dist', 'oidn'), { recursive: true });
  mkdirSync(join(tmp, 'app', 'dist', 'assets'), { recursive: true });
  writeFileSync(join(tmp, 'app', 'dist', 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(tmp, 'app', 'dist', 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(tmp, 'app', 'dist', 'oidn', 'w.tza'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(tmp, 'app', 'secret.txt'), 'nope');
  process.argv.push(`--smoke-test=${join(tmp, 'smoke.png')}`);
  await import('./main');
  h.ready!();
  await vi.waitFor(() => expect(h.exitCode).not.toBeNull(), { timeout: 10_000, interval: 50 });
});

afterAll(() => {
  process.argv = process.argv.filter((a) => !a.startsWith('--smoke-test'));
  rmSync(h.root, { recursive: true, force: true });
});

describe('main process (fake electron)', () => {
  it('appends the GPU switches from settings', () => {
    expect(h.switches.has('force_high_performance_gpu')).toBe(true);
    expect(h.switches.has('ignore-gpu-blocklist')).toBe(true);
    expect(h.switches.has('enable-unsafe-webgpu')).toBe(true);
    expect(h.switches.get('use-angle')).toBe('metal');
  });

  it('registers app:// as a privileged standard scheme', () => {
    expect(h.schemes).toEqual([
      {
        scheme: 'app',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
      },
    ]);
  });

  it('serves dist/ over app://planner with MIME types and a traversal guard', async () => {
    const r = await get('app://planner/index.html');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await r.text()).toContain('<title>t</title>');
    expect((await get('app://planner/')).status).toBe(200);
    const js = await get('app://planner/assets/index-abc.js');
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const tza = await get('app://planner/oidn/w.tza');
    expect(tza.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await tza.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect([403, 404]).toContain((await get('app://planner/%2e%2e/secret.txt')).status); // URL parser already drops %2e%2e
    expect((await get('app://planner/..%2fsecret.txt')).status).toBe(403);
    expect((await get('app://planner/missing.js')).status).toBe(404);
    expect((await get('app://planner/assets')).status).toBe(404);
    expect((await get('app://other/index.html')).status).toBe(404);
    expect((await get('app://planner/index.html', 'POST')).status).toBe(405);
    const head = await get('app://planner/index.html', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String('<!doctype html><title>t</title>'.length));
  });

  it('serves render outputs over app://renders but not outside', async () => {
    const renders = join(h.root, 'appData', 'Wedding Venue Studio', 'renders');
    mkdirSync(join(renders, 'job1'), { recursive: true });
    writeFileSync(join(renders, 'job1', 'render.png'), 'png');
    const r = await get('app://renders/job1/render.png');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect([403, 404]).toContain((await get('app://renders/%2e%2e/settings.json')).status);
    expect((await get('app://renders/..%2fsettings.json')).status).toBe(403);
  });

  it('creates a hardened window on app://planner/index.html', () => {
    const w = h.windows[0];
    expect(w.loaded).toEqual(['app://planner/index.html']);
    const wp = w.opts.webPreferences as Record<string, unknown>;
    expect(wp).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(String(wp.preload)).toMatch(/preload\.cjs$/);
    expect(wp.additionalArguments).toEqual(['--wp-version=1.2.3']);
    expect(w.opts).toMatchObject({ width: 1440, height: 900, minWidth: 1024, minHeight: 700 });
    expect(h.menu).toBeTruthy();
  });

  it('refuses IPC from other origins and answers the app', async () => {
    expect(await ipc('settings:get', untrusted)).toEqual({ ok: false, error: 'untrusted sender' });
    const s = await ipc('settings:get', trusted);
    expect(s).toEqual({ ok: true, value: { blenderPath: null, webgpu: true, angleBackend: 'metal', lastRenderPreset: 'draft' } });
    const set = await ipc('settings:set', trusted, { angleBackend: 'gl', blenderPath: 'relative' });
    expect(set.value).toMatchObject({ angleBackend: 'gl', blenderPath: null });
    const file = join(h.root, 'appData', 'Wedding Venue Studio', 'settings.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).angleBackend).toBe('gl');
  });

  it('guards shell access and reports a missing Blender cleanly', async () => {
    expect(await ipc('shell:openExternal', trusted, 'https://evil.example.com/')).toEqual({ ok: true, value: false });
    expect(await ipc('shell:openExternal', trusted, 'https://www.blender.org/download/lts/4-5/')).toEqual({ ok: true, value: true });
    expect((await ipc('shell:showItem', trusted, '/definitely/not/here')).ok).toBe(false);
    expect((await ipc('blender:openBlend', trusted, '/etc/passwd')).ok).toBe(false);
    const det = await ipc('blender:detect', trusted);
    expect(det).toMatchObject({ ok: true, value: { found: false, downloadUrl: 'https://www.blender.org/download/lts/4-5/' } });
    const r = await ipc('blender:render', trusted, { 'scene.json': '{}' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Blender was not found/);
    expect(await ipc('blender:cancel', trusted, 'nope')).toEqual({ ok: true, value: false });
    const gpu = await ipc('app:gpuInfo', trusted);
    expect(gpu.value).toMatchObject({ angleBackend: 'metal', webgpu: true, versions: { app: '1.2.3' } });
  });

  it('ran the smoke test: PNG + report written, exit 0', () => {
    expect(h.exitCode).toBe(0);
    expect(readFileSync(join(h.root, 'smoke.png'), 'utf8')).toBe('PNGDATA');
    const report = JSON.parse(readFileSync(join(h.root, 'smoke.json'), 'utf8'));
    expect(report).toMatchObject({ ok: true, capture: { width: 1440, height: 900 }, gpuFeatureStatus: { webgl2: 'enabled' } });
    expect(existsSync(join(h.root, 'logs', 'main.log'))).toBe(true);
  });
});

