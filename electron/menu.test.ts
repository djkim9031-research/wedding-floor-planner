import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ Menu: {} }));
const { menuTemplate } = await import('./menu');

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((it) => [it, ...(Array.isArray(it.submenu) ? flatten(it.submenu) : [])]);
}

describe('menuTemplate', () => {
  const sent: string[] = [];
  const actions = {
    send: (c: string) => sent.push(c),
    gpuInfo: vi.fn(),
    openLogs: vi.fn(),
    revealRenders: vi.fn(),
    openExternal: vi.fn(),
  };
  const tpl = menuTemplate('Wedding Venue Studio', actions, true);
  const all = flatten(tpl);
  const byLabel = (l: string): MenuItemConstructorOptions => all.find((i) => i.label === l)!;
  const click = (l: string): void => (byLabel(l).click as () => void)();

  it('has the mac menu bar in order', () => {
    expect(tpl.map((m) => m.label ?? m.role)).toEqual(['Wedding Venue Studio', 'File', 'Edit', 'View', 'windowMenu', 'help']);
  });

  it('sends planner commands to the renderer', () => {
    for (const l of ['Open Layout…', 'Save Layout As…', 'Export Photo…', 'Render in Blender…', 'Undo', 'Redo', 'Settings…']) click(l);
    expect(sent).toEqual(['open-layout', 'save-layout', 'export-photo', 'render-blender', 'undo', 'redo', 'settings']);
    expect(byLabel('Undo').accelerator).toBe('CmdOrCtrl+Z');
    expect(byLabel('Redo').accelerator).toBe('Shift+CmdOrCtrl+Z');
    expect(byLabel('Settings…').accelerator).toBe('CmdOrCtrl+,');
  });

  it('keeps clipboard roles for text fields and the view/help items', () => {
    const roles = all.map((i) => i.role).filter(Boolean);
    for (const r of ['about', 'quit', 'cut', 'copy', 'paste', 'selectAll', 'reload', 'toggleDevTools', 'resetZoom', 'togglefullscreen'])
      expect(roles).toContain(r);
    expect(byLabel('Actual Size').role).toBe('resetZoom');
    click('GPU Info');
    click('Open Logs Folder');
    click('Reveal Renders Folder');
    click('Download Blender 4.5 LTS');
    expect(actions.gpuInfo).toHaveBeenCalled();
    expect(actions.openLogs).toHaveBeenCalled();
    expect(actions.revealRenders).toHaveBeenCalled();
    expect(actions.openExternal).toHaveBeenCalledWith('https://www.blender.org/download/lts/4-5/');
  });

  it('has no duplicate accelerators', () => {
    const acc = all.map((i) => i.accelerator).filter(Boolean);
    expect(new Set(acc).size).toBe(acc.length);
  });
});
