import { describe, expect, it, vi } from 'vitest';
import type { WpNative } from '../src/platform/types';

const h = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: null as null | ((ch: string, ...a: unknown[]) => Promise<unknown>),
  bus: null as null | { emit(ch: string, ...a: unknown[]): void; listenerCount(ch: string): number },
}));

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const bus = new EE();
  h.bus = bus;
  return {
    contextBridge: { exposeInMainWorld: (k: string, v: unknown) => (h.exposed[k] = v) },
    ipcRenderer: {
      invoke: (ch: string, ...a: unknown[]) => h.invoke!(ch, ...a),
      on: (ch: string, l: (...a: unknown[]) => void) => bus.on(ch, l),
      removeListener: (ch: string, l: (...a: unknown[]) => void) => bus.removeListener(ch, l),
    },
  };
});

process.argv.push('--wp-version=9.9.9');
await import('./preload');
const api = h.exposed.wpNative as WpNative;

describe('preload (window.wpNative)', () => {
  it('exposes the contract', () => {
    expect(api.version).toBe('9.9.9');
    expect(api.platform).toBe(process.platform);
    expect(Object.keys(api).sort()).toEqual(
      ['blender', 'gpuInfo', 'onMenu', 'openExternal', 'openFile', 'platform', 'relaunch', 'saveFile', 'settings', 'showItem', 'version'].sort(),
    );
    expect(Object.keys(api.blender).sort()).toEqual(['cancel', 'choose', 'detect', 'onEvent', 'openBlend', 'render']);
  });

  it('unwraps replies and turns failures into Errors', async () => {
    const seen: unknown[][] = [];
    h.invoke = async (ch, ...a) => {
      seen.push([ch, ...a]);
      if (ch === 'blender:render') return { ok: false, error: 'A Blender render is already running — cancel it first.' };
      if (ch === 'file:open') return { ok: true, value: { name: 'x.json', data: new Uint8Array([1, 2, 3]) } };
      return { ok: true, value: '/Users/dj/Documents/x.json' };
    };
    expect(await api.saveFile({ name: 'x.json', data: '{}' })).toBe('/Users/dj/Documents/x.json');
    expect(seen[0]).toEqual(['file:save', { name: 'x.json', filters: [], data: '{}' }]);
    const opened = await api.openFile([{ name: 'Layout', extensions: ['json'] }]);
    expect(opened?.name).toBe('x.json');
    expect(opened?.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(opened!.data)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(api.blender.render({ 'scene.json': '{}' }, { preset: 'draft' })).rejects.toThrow(/already running/);
    expect(seen.at(-1)).toEqual(['blender:render', { 'scene.json': '{}' }, { preset: 'draft' }]);
  });

  it('subscribes and unsubscribes menu + blender events', () => {
    const menus: string[] = [];
    const off = api.onMenu((c) => menus.push(c));
    const evs: unknown[] = [];
    const offEv = api.blender.onEvent((id, ev) => evs.push([id, ev]));
    h.bus!.emit('menu', {}, 'undo');
    h.bus!.emit('blender:event', {}, 'job1', { ev: 'progress', pct: 50 });
    off();
    offEv();
    h.bus!.emit('menu', {}, 'redo');
    expect(menus).toEqual(['undo']);
    expect(evs).toEqual([['job1', { ev: 'progress', pct: 50 }]]);
    expect(h.bus!.listenerCount('menu')).toBe(0);
  });
});

