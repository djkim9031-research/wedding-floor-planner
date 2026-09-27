// userData/settings.json and userData/window.json. The parsing/sanitising is
// pure (unit-tested); load/save are tiny sync fs wrappers — settings are
// read before `app.ready` to pick Chromium GPU switches.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings, type BlenderPreset } from '../src/platform/types';

export { DEFAULT_SETTINGS };

const PRESETS: BlenderPreset[] = ['draft', 'standard', 'final'];

/** Coerce whatever is on disk (or sent by the renderer) into valid settings. */
export function sanitizeSettings(raw: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: AppSettings = { ...base };
  if (o.blenderPath === null) out.blenderPath = null;
  else if (typeof o.blenderPath === 'string' && o.blenderPath.startsWith('/') && !o.blenderPath.includes('\0')) {
    out.blenderPath = o.blenderPath;
  }
  if (typeof o.webgpu === 'boolean') out.webgpu = o.webgpu;
  if (o.angleBackend === 'metal' || o.angleBackend === 'gl') out.angleBackend = o.angleBackend;
  if (typeof o.lastRenderPreset === 'string' && PRESETS.includes(o.lastRenderPreset as BlenderPreset)) {
    out.lastRenderPreset = o.lastRenderPreset as BlenderPreset;
  }
  return out;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write via a temp file + rename so a crash never leaves half a JSON. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

export class SettingsStore {
  private value: AppSettings;
  constructor(private readonly file: string) {
    this.value = sanitizeSettings(readJson(file));
  }
  get(): AppSettings {
    return { ...this.value };
  }
  set(patch: unknown): AppSettings {
    this.value = sanitizeSettings(patch, this.value);
    try {
      writeJsonAtomic(this.file, this.value);
    } catch (e) {
      console.error('settings: could not save', e);
    }
    return this.get();
  }
}

export function settingsFile(userData: string): string {
  return join(userData, 'settings.json');
}

// ---- window state ----------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect | null;
  maximized: boolean;
  fullScreen: boolean;
}

export const DEFAULT_WINDOW = { width: 1440, height: 900, minWidth: 1024, minHeight: 700 };

function isRect(r: unknown): r is Rect {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(o[k]));
}

export function parseWindowState(raw: unknown): WindowState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    bounds: isRect(o.bounds) ? o.bounds : null,
    maximized: o.maximized === true,
    fullScreen: o.fullScreen === true,
  };
}

/**
 * Saved bounds if they are still (mostly) on a connected display, clamped to
 * the minimum size and that display's work area; else null (→ centred default).
 */
export function fitBounds(saved: Rect | null, workAreas: Rect[]): Rect | null {
  if (!saved) return null;
  const w = Math.max(DEFAULT_WINDOW.minWidth, Math.round(saved.width));
  const h = Math.max(DEFAULT_WINDOW.minHeight, Math.round(saved.height));
  let best: Rect | null = null;
  let bestArea = 0;
  for (const a of workAreas) {
    const ix = Math.max(0, Math.min(saved.x + w, a.x + a.width) - Math.max(saved.x, a.x));
    const iy = Math.max(0, Math.min(saved.y + h, a.y + a.height) - Math.max(saved.y, a.y));
    if (ix * iy > bestArea) {
      bestArea = ix * iy;
      best = a;
    }
  }
  // need a decent grab-able part of the window on screen
  if (!best || bestArea < Math.min(w * h * 0.25, 200 * 100)) return null;
  const width = Math.min(w, best.width);
  const height = Math.min(h, best.height);
  const x = Math.min(Math.max(Math.round(saved.x), best.x), best.x + best.width - width);
  const y = Math.min(Math.max(Math.round(saved.y), best.y), best.y + best.height - height);
  return { x, y, width, height };
}

export function loadWindowState(userData: string): WindowState {
  return parseWindowState(readJson(join(userData, 'window.json')));
}

export function saveWindowState(userData: string, state: WindowState): void {
  try {
    writeJsonAtomic(join(userData, 'window.json'), state);
  } catch {
    /* non-fatal */
  }
}
