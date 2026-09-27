// Sandboxed preload: exposes window.wpNative (see src/platform/types.ts).
// Only `electron` may be required here (sandbox: true) — keep it self-contained.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AppSettings,
  BlenderDetectResult,
  BlenderEvent,
  BlenderJob,
  BlenderRenderOptions,
  FileFilter,
  GpuInfo,
  MenuCommand,
  OpenedFile,
  SaveFileRequest,
  WpNative,
} from '../src/platform/types';

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

/** invoke + unwrap, so page code sees clean Error messages. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>;
  if (!r || typeof r !== 'object') throw new Error(`${channel}: no reply`);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function arg(name: string): string {
  const pre = `--${name}=`;
  return process.argv.find((a) => a.startsWith(pre))?.slice(pre.length) ?? '';
}

function toArrayBuffer(u: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (u instanceof ArrayBuffer) return u;
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: WpNative = {
  version: arg('wp-version'),
  platform: process.platform,
  saveFile: (req: SaveFileRequest) =>
    call<string | null>('file:save', { name: req.name, filters: req.filters ?? [], data: req.data }),
  openFile: async (filters?: FileFilter[]) => {
    const r = await call<{ name: string; data: Uint8Array } | null>('file:open', filters ?? []);
    return r ? ({ name: r.name, data: toArrayBuffer(r.data) } satisfies OpenedFile) : null;
  },
  blender: {
    detect: () => call<BlenderDetectResult>('blender:detect'),
    choose: () => call<BlenderDetectResult | null>('blender:choose'),
    render: (files: Record<string, ArrayBuffer | string>, opts?: BlenderRenderOptions) =>
      call<BlenderJob>('blender:render', files, opts ?? {}),
    cancel: (jobId: string) => call<boolean>('blender:cancel', jobId),
    onEvent: (cb: (jobId: string, ev: BlenderEvent) => void) => subscribe<[string, BlenderEvent]>('blender:event', cb),
    openBlend: (path: string) => call<boolean>('blender:openBlend', path),
  },
  showItem: (path: string) => call<void>('shell:showItem', path),
  openExternal: (url: string) => call<boolean>('shell:openExternal', url),
  gpuInfo: () => call<GpuInfo>('app:gpuInfo'),
  onMenu: (cb: (cmd: MenuCommand) => void) => subscribe<[MenuCommand]>('menu', cb),
  settings: {
    get: () => call<AppSettings>('settings:get'),
    set: (patch: Partial<AppSettings>) => call<AppSettings>('settings:set', patch),
  },
  relaunch: () => call<void>('app:relaunch'),
};

contextBridge.exposeInMainWorld('wpNative', api);
