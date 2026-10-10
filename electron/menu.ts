// Native menu bar. Planner commands go to the renderer as strings
// (wpNative.onMenu); window/app chores are handled here.
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/platform/types';

export interface MenuActions {
  /** forward a command to the renderer */
  send(cmd: MenuCommand): void;
  gpuInfo(): void;
  openLogs(): void;
  revealRenders(): void;
  openExternal(url: string): void;
}

export const PROJECT_URL = 'https://github.com/djkim9031-research/wedding-floor-planner';
export const BLENDER_URL = 'https://www.blender.org/download/lts/4-5/';

export function menuTemplate(appName: string, a: MenuActions, isMac = process.platform === 'darwin'): MenuItemConstructorOptions[] {
  const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => a.send(command),
  });
  const settings = cmd('Settings…', 'settings', 'CmdOrCtrl+,');

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settings,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      cmd('Open Layout…', 'open-layout', 'CmdOrCtrl+O'),
      cmd('Save Layout As…', 'save-layout', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      cmd('Export Photo…', 'export-photo', 'CmdOrCtrl+Shift+E'),
      cmd('Render in Blender…', 'render-blender', 'CmdOrCtrl+Shift+B'),
      { type: 'separator' },
      ...(isMac ? [{ role: 'close' } as MenuItemConstructorOptions] : [settings, { type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
    ],
  };

  // Undo/Redo are the planner's own history (the renderer falls back to the
  // text field's undo while one is focused); the clipboard roles make
  // ⌘C/⌘V/⌘X/⌘A work in text inputs.
  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
      cmd('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const help: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      { label: 'GPU Info', click: () => a.gpuInfo() },
      { label: 'Open Logs Folder', click: () => a.openLogs() },
      { label: 'Reveal Renders Folder', click: () => a.revealRenders() },
      { type: 'separator' },
      { label: 'Download Blender 4.5 LTS', click: () => a.openExternal(BLENDER_URL) },
      { label: 'Project on GitHub', click: () => a.openExternal(PROJECT_URL) },
    ],
  };

  return [...(isMac ? [appMenu] : []), file, edit, view, { role: 'windowMenu' }, help];
}

export function installMenu(appName: string, actions: MenuActions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(appName, actions)));
}
