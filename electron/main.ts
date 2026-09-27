// Wedding Venue Studio — Electron main process.
//
// One window serving the vite build over app://planner (stable origin for
// localStorage, secure context for WebGPU), a native menu, native file
// dialogs, and the Blender bridge (detect / render / progress / cancel).
// `--smoke-test=<png>` boots, captures the window and exits (CI).
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import type { AppSettings, BlenderDetectResult, BlenderEvent, GpuInfo, MenuCommand } from '../src/platform/types';
import {
  BlenderRunner,
  detectBlender,
  normalizeBlenderPath,
  probeBlender,
  appForExe,
  summarize,
  systemDetectDeps,
  toBuffer,
} from './blender';
import { installMenu } from './menu';
import { isAllowedExternal, safeFileName, sanitizeFilters } from './policy';
import { APP_ORIGIN, installAppProtocol, isInside, registerAppScheme, START_URL } from './protocol';
import {
  DEFAULT_WINDOW,
  fitBounds,
  loadWindowState,
  saveWindowState,
  SettingsStore,
  settingsFile,
} from './settings';
import { runSmoke, smokeTarget } from './smoke';

const APP_NAME = 'Wedding Venue Studio';
const isMac = process.platform === 'darwin';

// ---- identity & paths (before ready) -----------------------------------------
app.setName(APP_NAME);
app.setPath('userData', join(app.getPath('appData'), APP_NAME));
// ~/Library/Logs/Wedding Venue Studio (Help ▸ Open Logs Folder)
app.setAppLogsPath(
  isMac ? join(app.getPath('home'), 'Library', 'Logs', APP_NAME) : join(app.getPath('userData'), 'logs'),
);

const smokePng = smokeTarget(process.argv);
const userData = app.getPath('userData');
const logsDir = app.getPath('logs');
const rendersRoot = join(userData, 'renders');
const appRoot = join(app.getAppPath(), 'dist');
const renderScript = app.isPackaged
  ? join(process.resourcesPath, 'blender', 'render_venue.py')
  : join(app.getAppPath(), 'blender', 'render_venue.py');

// ---- logging -----------------------------------------------------------------
const mainLog = join(logsDir, 'main.log');
let logLines = 0;
function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  if (!app.isPackaged || smokePng) process.stdout.write(line);
  try {
    if (logLines++ % 500 === 0) {
      mkdirSync(logsDir, { recursive: true });
      if (existsSync(mainLog) && statSync(mainLog).size > 2 * 1024 * 1024) renameSync(mainLog, join(logsDir, 'main.1.log'));
    }
    appendFileSync(mainLog, line);
  } catch {
    /* logging must never throw */
  }
}
process.on('uncaughtException', (e) => log(`uncaughtException ${e.stack ?? e}`));
process.on('unhandledRejection', (e) => log(`unhandledRejection ${String((e as Error)?.stack ?? e)}`));

// ---- settings & GPU switches (must precede ready) ------------------------------
const settings = new SettingsStore(settingsFile(userData));
{
  const s = settings.get();
  const cl = app.commandLine;
  cl.appendSwitch('force_high_performance_gpu'); // the discrete Radeon on dual-GPU MacBook Pros
  cl.appendSwitch('ignore-gpu-blocklist');
  // trusted local content only: a software WebGL fallback beats a blank window
  cl.appendSwitch('enable-unsafe-swiftshader');
  if (s.webgpu) cl.appendSwitch('enable-unsafe-webgpu'); // OIDN denoiser
  if (!cl.hasSwitch('use-angle')) cl.appendSwitch('use-angle', s.angleBackend);
  log(`start ${APP_NAME} ${app.getVersion()} electron ${process.versions.electron} angle=${s.angleBackend} webgpu=${s.webgpu}${smokePng ? ' smoke=' + smokePng : ''}`);
}

registerAppScheme();

// ---- window --------------------------------------------------------------------
let win: BrowserWindow | null = null;

// hiddenInset title bar: keep the web toolbar clear of the traffic lights and
// make the title chip the window's drag handle
const INSET_CSS = `.topbar{left:88px!important}.app-title{-webkit-app-region:drag;cursor:default}`;
const FULLSCREEN_CSS = `.app-title{-webkit-app-region:drag;cursor:default}`;

function createWindow(): BrowserWindow {
  const saved = smokePng ? null : loadWindowState(userData);
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const primary = screen.getPrimaryDisplay().workArea;
  const bounds = saved ? fitBounds(saved.bounds, areas) : null;

  const w = new BrowserWindow({
    width: bounds?.width ?? Math.min(DEFAULT_WINDOW.width, primary.width),
    height: bounds?.height ?? Math.min(DEFAULT_WINDOW.height, primary.height),
    x: bounds?.x,
    y: bounds?.y,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    title: APP_NAME,
    backgroundColor: '#efe9df',
    show: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 26 } } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: !smokePng,
      additionalArguments: [`--wp-version=${app.getVersion()}`],
    },
  });

  let shown = false;
  const show = (): void => {
    if (shown || w.isDestroyed()) return;
    shown = true;
    w.show();
    if (saved?.maximized) w.maximize();
    if (saved?.fullScreen) w.setFullScreen(true);
  };
  w.once('ready-to-show', show);
  setTimeout(show, 4000); // never stay invisible

  // title-bar CSS, re-applied on every load (reload keeps working)
  let cssKey: string | null = null;
  const applyChromeCss = async (): Promise<void> => {
    if (!isMac) return;
    if (cssKey) await w.webContents.removeInsertedCSS(cssKey).catch(() => undefined);
    cssKey = await w.webContents.insertCSS(w.isFullScreen() ? FULLSCREEN_CSS : INSET_CSS).catch(() => null);
  };
  w.webContents.on('dom-ready', () => {
    cssKey = null;
    void applyChromeCss();
  });
  w.on('enter-full-screen', () => void applyChromeCss());
  w.on('leave-full-screen', () => void applyChromeCss());

  w.on('close', () => {
    if (smokePng) return;
    saveWindowState(userData, { bounds: w.getNormalBounds(), maximized: w.isMaximized(), fullScreen: w.isFullScreen() });
  });
  w.on('closed', () => {
    if (win === w) win = null;
  });

  w.webContents.on('console-message', (e) => {
    if (e.level === 'error') {
      const msg = `renderer error: ${e.message} (${e.sourceId}:${e.lineNumber})`;
      consoleErrors.push(msg);
      if (consoleErrors.length > 200) consoleErrors.shift();
      log(msg);
    }
  });
  w.webContents.on('render-process-gone', (_e, d) => {
    fatal ??= `renderer gone: ${d.reason} (exit ${d.exitCode})`;
    log(fatal);
  });
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    fatal ??= `load failed: ${desc} (${code}) ${url}`;
    log(fatal);
  });

  void w.loadURL(START_URL);
  return w;
}

const consoleErrors: string[] = [];
let fatal: string | null = null;

function send(cmd: MenuCommand): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('menu', cmd);
}

function emitBlender(jobId: string, ev: BlenderEvent): void {
  if (ev.ev !== 'progress') log(`blender ${jobId} ${ev.ev} ${JSON.stringify(ev).slice(0, 400)}`);
  if (win && !win.isDestroyed()) win.webContents.send('blender:event', jobId, ev);
}

function openGpuInfo(): void {
  const w = new BrowserWindow({ width: 980, height: 820, title: 'GPU Info', backgroundColor: '#ffffff' });
  void w.loadURL('chrome://gpu');
}

// ---- security ------------------------------------------------------------------
function isTrusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(APP_ORIGIN + '/');
}

function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (e) => {
    if (!e.url.startsWith(APP_ORIGIN + '/')) {
      e.preventDefault();
      if (isAllowedExternal(e.url)) void shell.openExternal(e.url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
}

// ---- IPC -------------------------------------------------------------------------
type Handler = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!isTrusted(e)) {
      log(`ipc ${channel}: refused sender ${e.senderFrame?.url ?? '?'}`);
      return { ok: false, error: 'untrusted sender' };
    }
    try {
      return { ok: true, value: await fn(e, ...args) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ipc ${channel} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

let lastDir: string | null = null;
const MAX_OPEN_BYTES = 256 * 1024 * 1024;

const runner = new BlenderRunner({ rendersRoot, scriptPath: renderScript, emit: emitBlender, log });

async function detect(): Promise<BlenderDetectResult> {
  const r = await detectBlender(systemDetectDeps(homedir(), settings.get().blenderPath));
  log(`blender detect: ${r.install ? r.install.label + ' @ ' + r.install.path : 'none'} found=${r.found}${r.warning ? ' warn=' + r.warning : ''}`);
  return r;
}

function isRenderOutput(p: unknown): p is string {
  return typeof p === 'string' && isAbsolute(p) && isInside(resolve(rendersRoot), resolve(p)) && existsSync(p);
}

function registerIpc(): void {
  handle('file:save', async (e, raw) => {
    const req = (raw ?? {}) as { name?: unknown; filters?: unknown; data?: unknown };
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      defaultPath: join(lastDir ?? app.getPath('documents'), safeFileName(req.name)),
      filters: sanitizeFilters(req.filters),
      properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<'createDirectory' | 'showOverwriteConfirmation'>,
    };
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, toBuffer(req.data));
    lastDir = dirname(res.filePath);
    log(`saved ${res.filePath}`);
    return res.filePath;
  });

  handle('file:open', async (e, filters) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      defaultPath: lastDir ?? app.getPath('documents'),
      filters: sanitizeFilters(filters),
      properties: ['openFile'] as Array<'openFile'>,
    };
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    if (statSync(file).size > MAX_OPEN_BYTES) throw new Error('That file is too large to open.');
    const data = await readFile(file);
    lastDir = dirname(file);
    return { name: basename(file), data: new Uint8Array(data) };
  });

  handle('blender:detect', () => detect());

  handle('blender:choose', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: 'Choose Blender',
      defaultPath: '/Applications',
      buttonLabel: 'Choose',
      filters: [{ name: 'Applications', extensions: ['app'] }],
      properties: ['openFile'] as Array<'openFile'>,
    };
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const picked = res.filePaths[0];
    if (res.canceled || !picked) return null;
    const exe = normalizeBlenderPath(picked);
    const inst = await probeBlender({ path: exe, app: appForExe(exe), source: 'chosen' }, systemDetectDeps(homedir(), null));
    if (!inst) return summarize([], `${picked} did not answer \`--version\` — is it Blender?`);
    settings.set({ blenderPath: exe });
    const r = await detect();
    return r.install?.path === exe ? r : summarize([inst, ...r.all.filter((i) => i.path !== exe)]);
  });

  handle('blender:render', async (_e, files, opts) => {
    const d = await detect();
    if (!d.install) throw new Error('Blender was not found — install Blender 4.5 LTS or choose it in Settings.');
    const o = (opts ?? {}) as { preset?: AppSettings['lastRenderPreset'] };
    if (o.preset) settings.set({ lastRenderPreset: o.preset });
    return runner.start(d.install, (files ?? {}) as Record<string, unknown>, opts);
  });

  handle('blender:cancel', (_e, jobId) => typeof jobId === 'string' && runner.cancel(jobId));

  handle('blender:openBlend', async (_e, p) => {
    if (!isRenderOutput(p) || !p.endsWith('.blend')) throw new Error('Not a render output .blend');
    const d = await detect();
    const inst = d.install;
    if (inst?.app && isMac) {
      await new Promise<void>((res, rej) => execFile('open', ['-a', inst.app!, p], (err) => (err ? rej(err) : res())));
    } else if (inst) {
      spawn(inst.path, [p], { detached: true, stdio: 'ignore', cwd: dirname(p) }).unref();
    } else {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    }
    return true;
  });

  handle('shell:showItem', (_e, p) => {
    if (typeof p !== 'string' || !isAbsolute(p) || !existsSync(p)) throw new Error('No such file');
    shell.showItemInFolder(p);
  });

  handle('shell:openExternal', async (_e, url) => {
    if (typeof url !== 'string' || !isAllowedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  handle('app:gpuInfo', async (): Promise<GpuInfo> => {
    const s = settings.get();
    return {
      featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
      gpu: await app.getGPUInfo('basic'),
      angleBackend: app.commandLine.getSwitchValue('use-angle') || s.angleBackend,
      webgpu: app.commandLine.hasSwitch('enable-unsafe-webgpu'),
      versions: {
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
        app: app.getVersion(),
      },
    };
  });

  handle('settings:get', () => settings.get());
  handle('settings:set', (_e, patch) => {
    const next = settings.set(patch);
    log(`settings ${JSON.stringify(next)}`);
    return next;
  });

  handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

// ---- lifecycle ---------------------------------------------------------------------
const gotLock = smokePng ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('web-contents-created', (_e, contents) => hardenContents(contents));

  let quitConfirmed = false;
  app.on('before-quit', (e) => {
    const job = runner.running;
    if (!job || quitConfirmed || smokePng) return;
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      message: 'A Blender render is still running.',
      detail: 'Quitting stops it. The finished part is not kept.',
      buttons: ['Keep Rendering', 'Quit'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) {
      e.preventDefault();
      return;
    }
    quitConfirmed = true;
    runner.killAll();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('activate', () => {
    if (!win && app.isReady()) win = createWindow();
  });

  void app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: '© 2026 DJ Kim',
      credits: 'Wedding venue planner — three.js, with Blender Cycles renders.',
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'clipboard-sanitized-write' || permission === 'fullscreen' || permission === 'pointerLock');
    });
    mkdirSync(rendersRoot, { recursive: true });
    installAppProtocol({ appRoot, rendersRoot, log });
    registerIpc();
    installMenu(APP_NAME, {
      send,
      gpuInfo: openGpuInfo,
      openLogs: () => {
        mkdirSync(logsDir, { recursive: true });
        void shell.openPath(logsDir);
      },
      revealRenders: () => {
        mkdirSync(rendersRoot, { recursive: true });
        void shell.openPath(rendersRoot);
      },
      openExternal: (url) => {
        if (isAllowedExternal(url)) void shell.openExternal(url);
      },
    });
    if (!existsSync(join(appRoot, 'index.html'))) log(`WARNING: ${appRoot}/index.html missing — run \`npm run electron:build\``);
    if (!existsSync(renderScript)) log(`WARNING: ${renderScript} missing — Render in Blender will fail`);

    win = createWindow();

    if (smokePng) {
      const hard = setTimeout(() => {
        console.log('WP_SMOKE ' + JSON.stringify({ ok: false, failure: 'hard timeout (150 s)' }));
        app.exit(3);
      }, 150_000);
      const code = await runSmoke({
        win,
        png: resolve(smokePng),
        log,
        fatal: () => fatal,
        consoleErrors,
      }).catch((e) => {
        console.log('WP_SMOKE ' + JSON.stringify({ ok: false, failure: String(e?.stack ?? e) }));
        return 2;
      });
      clearTimeout(hard);
      log(`smoke exit ${code}`);
      app.exit(code);
    }
  });
}
