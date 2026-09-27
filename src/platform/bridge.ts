// platform() — the native bridge (window.wpNative, Mac app) when present,
// else a web implementation with the same shape: saveFile = download,
// openFile = <input type=file>, blender = unavailable (callers offer the
// scene-package zip instead).
import { acceptFromFilters, downloadBlob, mimeForName } from './files';
import {
  BLENDER_DOWNLOAD_URL,
  DEFAULT_SETTINGS,
  type AppSettings,
  type BlenderDetectResult,
  type FileFilter,
  type GpuInfo,
  type OpenedFile,
  type SaveFileRequest,
  type WpNative,
} from './types';

export * from './types';

declare global {
  interface Window {
    /** present only inside the Mac app (electron/preload.ts) — prefer platform() */
    wpNative?: WpNative;
  }
}

export interface Platform extends WpNative {
  /** true inside the Mac app */
  native: boolean;
}

let cached: Platform | null = null;

export function nativeBridge(): WpNative | null {
  return (globalThis as { wpNative?: WpNative }).wpNative ?? null;
}

export function isNativeApp(): boolean {
  return nativeBridge() !== null;
}

export function platform(): Platform {
  if (cached) return cached;
  const n = nativeBridge();
  cached = n ? wrapNative(n) : webPlatform();
  return cached;
}

// Explicit delegation rather than a spread: contextBridge hands the page a
// proxied copy, and this keeps every call going through it.
function wrapNative(n: WpNative): Platform {
  return {
    native: true,
    version: n.version,
    platform: n.platform,
    saveFile: (req) => n.saveFile(req),
    openFile: (filters) => n.openFile(filters),
    blender: {
      detect: () => n.blender.detect(),
      choose: () => n.blender.choose(),
      render: (files, opts) => n.blender.render(files, opts),
      cancel: (jobId) => n.blender.cancel(jobId),
      onEvent: (cb) => n.blender.onEvent(cb),
      openBlend: (path) => n.blender.openBlend(path),
    },
    showItem: (path) => n.showItem(path),
    openExternal: (url) => n.openExternal(url),
    gpuInfo: () => n.gpuInfo(),
    onMenu: (cb) => n.onMenu(cb),
    settings: {
      get: () => n.settings.get(),
      set: (patch) => n.settings.set(patch),
    },
    relaunch: () => n.relaunch(),
  };
}

/** https only; the web build opens a tab, the app its default browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function webSaveFile(req: SaveFileRequest): Promise<string | null> {
  const blob = new Blob([req.data], { type: mimeForName(req.name) });
  downloadBlob(blob, req.name);
  return Promise.resolve(req.name);
}

// Must run synchronously inside the click that asked for it: input.click()
// needs the user activation.
function webOpenFile(filters?: FileFilter[]): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const accept = acceptFromFilters(filters);
    if (accept) input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.arrayBuffer().then(
        (data) => resolve({ name: file.name, data }),
        () => resolve(null),
      );
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function webGpuInfo(): Promise<GpuInfo> {
  let renderer = 'unknown';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* no WebGL */
  }
  return Promise.resolve({
    featureStatus: { webgpu: 'gpu' in navigator ? 'available' : 'unavailable' },
    gpu: { renderer },
    angleBackend: 'browser',
    webgpu: 'gpu' in navigator,
    versions: { userAgent: navigator.userAgent },
  });
}

function webPlatform(): Platform {
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  const noBlender: BlenderDetectResult = {
    found: false,
    install: null,
    all: [],
    unavailable: true,
    warning: 'Rendering in Blender needs the Mac app — download the scene package instead.',
    downloadUrl: BLENDER_DOWNLOAD_URL,
  };
  return {
    native: false,
    version: 'web',
    platform: 'web',
    saveFile: webSaveFile,
    openFile: webOpenFile,
    blender: {
      detect: () => Promise.resolve({ ...noBlender }),
      choose: () => Promise.resolve(null),
      render: () => Promise.reject(new Error(noBlender.warning)),
      cancel: () => Promise.resolve(false),
      onEvent: () => () => {},
      openBlend: () => Promise.resolve(false),
    },
    showItem: () => Promise.resolve(),
    openExternal: (url) => {
      if (!isSafeExternalUrl(url)) return Promise.resolve(false);
      window.open(url, '_blank', 'noopener');
      return Promise.resolve(true);
    },
    gpuInfo: webGpuInfo,
    onMenu: () => () => {},
    settings: {
      get: () => Promise.resolve({ ...settings }),
      set: (patch) => {
        settings = { ...settings, ...patch };
        return Promise.resolve({ ...settings });
      },
    },
    relaunch: () => {
      location.reload();
      return Promise.resolve();
    },
  };
}

/** Test hook: forget the cached platform (e.g. after stubbing wpNative). */
export function resetPlatformForTests(): void {
  cached = null;
}
