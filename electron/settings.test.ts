import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  fitBounds,
  loadWindowState,
  parseWindowState,
  sanitizeSettings,
  saveWindowState,
  settingsFile,
} from './settings';

describe('sanitizeSettings', () => {
  it('fills defaults and keeps valid values', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ blenderPath: null, webgpu: true, angleBackend: 'metal', lastRenderPreset: 'draft' });
    expect(
      sanitizeSettings({ blenderPath: '/Applications/Blender.app/Contents/MacOS/Blender', webgpu: false, angleBackend: 'gl', lastRenderPreset: 'final' }),
    ).toEqual({ blenderPath: '/Applications/Blender.app/Contents/MacOS/Blender', webgpu: false, angleBackend: 'gl', lastRenderPreset: 'final' });
  });

  it('rejects junk', () => {
    expect(sanitizeSettings({ blenderPath: 'relative/path', webgpu: 'yes', angleBackend: 'vulkan', lastRenderPreset: 'ultra', extra: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(sanitizeSettings({ blenderPath: '/a\0b' }).blenderPath).toBeNull();
  });

  it('patches over a base, null clears the Blender path', () => {
    const base = { ...DEFAULT_SETTINGS, blenderPath: '/x/Blender', angleBackend: 'gl' as const };
    expect(sanitizeSettings({ webgpu: false }, base)).toEqual({ ...base, webgpu: false });
    expect(sanitizeSettings({ blenderPath: null }, base).blenderPath).toBeNull();
  });
});

describe('SettingsStore / window state files', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'wp-settings-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips settings and survives a corrupt file', () => {
    const file = settingsFile(dir);
    const s = new SettingsStore(file);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    s.set({ angleBackend: 'gl', webgpu: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ angleBackend: 'gl', webgpu: false });
    expect(new SettingsStore(file).get().angleBackend).toBe('gl');
    writeFileSync(file, '{ nope');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips window state', () => {
    expect(loadWindowState(dir)).toEqual({ bounds: null, maximized: false, fullScreen: false });
    saveWindowState(dir, { bounds: { x: 10, y: 20, width: 1400, height: 880 }, maximized: true, fullScreen: false });
    expect(loadWindowState(dir)).toEqual({ bounds: { x: 10, y: 20, width: 1400, height: 880 }, maximized: true, fullScreen: false });
    expect(parseWindowState({ bounds: { x: 'a' }, maximized: 'yes' })).toEqual({ bounds: null, maximized: false, fullScreen: false });
  });
});

describe('fitBounds', () => {
  const laptop = { x: 0, y: 25, width: 1536, height: 935 };
  const external = { x: 1536, y: 0, width: 2560, height: 1415 };

  it('keeps bounds that are on screen', () => {
    expect(fitBounds({ x: 40, y: 60, width: 1440, height: 860 }, [laptop])).toEqual({ x: 40, y: 60, width: 1440, height: 860 });
    expect(fitBounds({ x: 1700, y: 100, width: 1440, height: 900 }, [laptop, external])).toEqual({ x: 1700, y: 100, width: 1440, height: 900 });
  });

  it('drops bounds on a disconnected display', () => {
    expect(fitBounds({ x: 1700, y: 100, width: 1440, height: 900 }, [laptop])).toBeNull();
    expect(fitBounds(null, [laptop])).toBeNull();
  });

  it('clamps to the work area and the minimum size', () => {
    expect(fitBounds({ x: -200, y: 0, width: 3000, height: 2000 }, [laptop])).toEqual({ x: 0, y: 25, width: 1536, height: 935 });
    expect(fitBounds({ x: 100, y: 100, width: 300, height: 200 }, [laptop])).toEqual({ x: 100, y: 100, width: 1024, height: 700 });
  });
});
