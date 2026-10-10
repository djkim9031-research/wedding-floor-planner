// Renderer side of the Mac app's menu bar. The main process sends command
// strings (wpNative.onMenu); features claim the ones they implement:
//
//   onNativeMenu('export-photo', () => photo.save());     // Photo mode (F)
//   onNativeMenu('render-blender', () => openBlenderDialog()); // export (G)
//
// One handler per command (the latest registration wins). Commands nobody
// claimed fall back to the defaults below. No-op on the web build.
import { platform, type MenuCommand } from './bridge';
import { showBlenderStatus } from './blenderUi';
import { openSettingsDialog } from './settingsDialog';

type Handler = () => void;

const handlers = new Map<string, Handler>();
const fallbacks: Record<string, Handler> = {
  settings: () => void openSettingsDialog(),
  'render-blender': () => void showBlenderStatus(),
};
let installed = false;

export function onNativeMenu(cmd: MenuCommand, fn: Handler): () => void {
  handlers.set(cmd, fn);
  installNativeMenu();
  return () => {
    if (handlers.get(cmd) === fn) handlers.delete(cmd);
  };
}

export function dispatchMenuCommand(cmd: MenuCommand): boolean {
  const fn = handlers.get(cmd) ?? fallbacks[cmd];
  if (!fn) {
    console.info(`[menu] no handler for "${cmd}"`);
    return false;
  }
  try {
    fn();
  } catch (e) {
    console.error(`[menu] "${cmd}" failed`, e);
  }
  return true;
}

/** Subscribe once to the native menu (idempotent; nothing on the web). */
export function installNativeMenu(): void {
  if (installed) return;
  installed = true;
  const p = platform();
  if (p.native) p.onMenu((cmd) => dispatchMenuCommand(cmd));
}

/** Text fields keep their own undo stack (Edit ▸ Undo while typing a name). */
export function textFieldFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)$/i.test((el as HTMLInputElement).type);
}
