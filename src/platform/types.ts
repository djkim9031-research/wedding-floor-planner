// Native bridge contract — `window.wpNative`, exposed by electron/preload.ts
// through contextBridge and mirrored by the web fallback in ./bridge.ts.
// Pure types only: this file is compiled by both the renderer tsconfig and
// electron/tsconfig.json, so it must not touch DOM or Node APIs.

export interface FileFilter {
  name: string;
  /** without dots, e.g. ['json'] */
  extensions: string[];
}

export interface SaveFileRequest {
  /** suggested file name, e.g. "wedding-layout.json" */
  name: string;
  filters?: FileFilter[];
  /** raw bytes; a string is written as UTF-8 */
  data: ArrayBuffer | string;
}

export interface OpenedFile {
  name: string;
  data: ArrayBuffer;
}

export type BlenderPreset = 'draft' | 'standard' | 'final';
export type BlenderDevice = 'auto' | 'cpu' | 'gpu';

/** Where a Blender candidate was found. */
export type BlenderSource = 'settings' | 'applications' | 'user-applications' | 'spotlight' | 'chosen';

export interface BlenderInstall {
  /** the executable, …/Blender.app/Contents/MacOS/Blender */
  path: string;
  /** the .app bundle, when the executable lives in one */
  app: string | null;
  /** "4.5.3" */
  version: string;
  /** first line of `--version`, e.g. "Blender 4.5.3 LTS" */
  label: string;
  /** 4.2 ≤ version < 5.0 */
  supported: boolean;
  source: BlenderSource;
}

export interface BlenderDetectResult {
  /** a supported Blender is available for rendering */
  found: boolean;
  /** best candidate (may be unsupported — see `warning`) */
  install: BlenderInstall | null;
  /** every Blender that answered `--version` */
  all: BlenderInstall[];
  warning?: string;
  /** Blender 4.5 LTS download page (last release with an Intel Mac build) */
  downloadUrl: string;
  /** true on the web build: there is no Blender bridge, offer the zip */
  unavailable?: boolean;
}

export interface BlenderRenderOptions {
  preset?: BlenderPreset;
  width?: number;
  height?: number;
  samples?: number;
  device?: BlenderDevice;
  /** render with a Blender outside 4.2–4.x anyway */
  force?: boolean;
}

export interface BlenderJob {
  jobId: string;
  /** absolute job directory (userData/renders/<yyyymmdd-hhmmss>) */
  dir: string;
  blender: string;
  version: string;
}

/**
 * Job events, delivered as `onEvent(cb)` → cb(jobId, ev). `stage`/`progress`
 * come from render_venue.py's `@@WP {json}` lines (plus progress parsed from
 * Cycles' own `Sample n/N` / `Remaining:` lines). Every job ends with exactly
 * one terminal `result` or `error` event (error.cancelled for a cancel).
 */
export type BlenderEvent =
  | { ev: 'stage'; stage: string; message?: string; [k: string]: unknown }
  | {
      ev: 'progress';
      sample?: number;
      of?: number;
      /** 0–100 */
      pct?: number;
      etaSec?: number;
      [k: string]: unknown;
    }
  | {
      ev: 'result';
      dir: string;
      /** file names in the job dir */
      files: string[];
      /** absolute path of the main still / panorama (png), if any */
      image?: string;
      /** absolute path of the saved .blend, if any */
      blend?: string;
      /** app:// URLs for showing outputs in the renderer: name → url */
      urls: Record<string, string>;
      elapsedSec: number;
      /** payload of the script's own `@@WP {"ev":"result",…}` line */
      script?: Record<string, unknown>;
      [k: string]: unknown;
    }
  | {
      ev: 'error';
      message: string;
      cancelled?: boolean;
      code?: number | null;
      signal?: string | null;
      stderrTail?: string;
      dir?: string;
      logFile?: string;
      [k: string]: unknown;
    };

export interface GpuInfo {
  /** app.getGPUFeatureStatus() — webgl/webgl2/webgpu/gpu_compositing … */
  featureStatus: Record<string, string>;
  /** app.getGPUInfo('basic') */
  gpu: unknown;
  angleBackend: string;
  webgpu: boolean;
  versions: Record<string, string>;
}

export type AngleBackend = 'metal' | 'gl';

export interface AppSettings {
  /** user-chosen Blender executable (null = auto-detect) */
  blenderPath: string | null;
  /** pass --enable-unsafe-webgpu (the OIDN denoiser needs WebGPU) */
  webgpu: boolean;
  /** --use-angle=<backend>, applied at startup */
  angleBackend: AngleBackend;
  lastRenderPreset: BlenderPreset;
}

/** Commands the native menu sends to the renderer. */
export type MenuCommand =
  | 'undo'
  | 'redo'
  | 'open-layout'
  | 'save-layout'
  | 'export-photo'
  | 'render-blender'
  | 'settings'
  | (string & {});

export interface WpNative {
  /** app version, e.g. "1.0.0" */
  version: string;
  /** process.platform ('darwin') — 'web' in the browser fallback */
  platform: string;
  /** native save panel; resolves the written path, or null when cancelled */
  saveFile(req: SaveFileRequest): Promise<string | null>;
  /** native open panel; null when cancelled */
  openFile(filters?: FileFilter[]): Promise<OpenedFile | null>;
  blender: {
    detect(): Promise<BlenderDetectResult>;
    /** pick a Blender.app by hand; null when the panel was cancelled */
    choose(): Promise<BlenderDetectResult | null>;
    /**
     * Writes `files` (scene.glb, scene.json, sky.exr, …) into a fresh job dir
     * and starts Blender headless. Resolves once Blender is running; follow
     * the job with onEvent. Rejects when another job runs or Blender is missing.
     */
    render(files: Record<string, ArrayBuffer | string>, opts?: BlenderRenderOptions): Promise<BlenderJob>;
    cancel(jobId: string): Promise<boolean>;
    onEvent(cb: (jobId: string, ev: BlenderEvent) => void): () => void;
    /** open a finished job's .blend in the Blender GUI */
    openBlend(path: string): Promise<boolean>;
  };
  /** reveal in Finder */
  showItem(path: string): Promise<void>;
  /** https only, allowlisted hosts (blender.org, github.com) */
  openExternal(url: string): Promise<boolean>;
  gpuInfo(): Promise<GpuInfo>;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  /** restart the app (GPU settings apply at startup) */
  relaunch(): Promise<void>;
}

export const BLENDER_DOWNLOAD_URL = 'https://www.blender.org/download/lts/4-5/';

export const DEFAULT_SETTINGS: AppSettings = {
  blenderPath: null,
  webgpu: true,
  angleBackend: 'metal',
  lastRenderPreset: 'draft',
};
