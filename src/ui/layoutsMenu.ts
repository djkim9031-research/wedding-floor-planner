import { PRESETS, isTable } from '../constants';
import { platform } from '../platform/bridge';
import { arrayBufferToText } from '../platform/files';
import { onNativeMenu, textFieldFocused } from '../platform/nativeMenu';
import * as persist from '../state/persist';
import * as store from '../state/store';
import { askText, confirmBox } from './dialog';

let openPanel: HTMLElement | null = null;

function closeMenus(): void {
  if (openPanel) {
    openPanel.classList.remove('open');
    openPanel = null;
  }
}

document.addEventListener('pointerdown', (e) => {
  if (openPanel && !(e.target as HTMLElement).closest('.menu-wrap')) closeMenus();
});

export function makeMenu(label: string, fill: (panel: HTMLElement) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';
  const btn = document.createElement('button');
  btn.className = 'ui-btn';
  btn.textContent = `${label} ▾`;
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  wrap.append(btn, panel);
  btn.addEventListener('click', () => {
    const isOpen = panel.classList.contains('open');
    closeMenus();
    if (!isOpen) {
      panel.innerHTML = '';
      fill(panel);
      panel.classList.add('open');
      openPanel = panel;
    }
  });
  return wrap;
}

function menuItem(label: string, hint: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'ui-btn menu-item';
  const name = document.createElement('span');
  name.textContent = label;
  const h = document.createElement('span');
  h.className = 'hint';
  h.textContent = hint;
  btn.append(name, h);
  btn.addEventListener('click', () => {
    onClick();
    closeMenus();
  });
  return btn;
}

export function buildPresetsMenu(toast: (msg: string) => void): HTMLElement {
  return makeMenu('Presets', (panel) => {
    for (const preset of PRESETS) {
      const tables = preset.items.filter((it) => isTable(it.type)).length;
      panel.appendChild(
        menuItem(preset.name, `${tables} tables + linen`, () => {
          store.applyPreset(preset.name);
          toast(`Preset “${preset.name}” placed`);
        }),
      );
    }
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    panel.appendChild(sep);
    panel.appendChild(
      menuItem('Clear floor', 'remove everything', () => {
        store.clearAll();
      }),
    );
  });
}

/** Name + store the current layout (inline dialog instead of window.prompt,
 * which the Mac app doesn't have). */
async function saveCurrentLayout(toast: (msg: string) => void): Promise<void> {
  const existing = persist.listLayouts();
  const name = await askText('Save layout', 'Layout ' + (existing.length + 1), { label: 'Layout name' });
  if (!name) return;
  if (
    existing.includes(name) &&
    !(await confirmBox(`Replace “${name}”?`, 'A saved layout with this name already exists.', { okLabel: 'Replace' }))
  ) {
    return;
  }
  persist.saveLayout(name, store.getState().items);
  toast(`Saved “${name}”`);
}

async function exportLayoutFile(toast: (msg: string) => void): Promise<void> {
  const saved = await persist.exportLayout(store.getState().items);
  // the browser download shows itself; the Mac app confirms where it went
  if (saved && platform().native) toast(`Exported “${saved.split('/').pop()}”`);
}

async function importLayoutFile(toast: (msg: string) => void): Promise<void> {
  const file = await platform().openFile(persist.LAYOUT_FILTERS);
  if (!file) return;
  const items = persist.parseLayout(arrayBufferToText(file.data));
  if (items) {
    store.importItems(items);
    toast(`Imported “${file.name}”`);
  } else {
    toast('Could not read that layout file');
  }
}

let nativeMenuWired = false;

/** Mac app menu bar → the same actions as the toolbar (no-op on the web). */
function wireNativeMenu(toast: (msg: string) => void): void {
  if (nativeMenuWired) return;
  nativeMenuWired = true;
  // Edit ▸ Undo/Redo own ⌘Z; while typing, they act on the text field instead
  onNativeMenu('undo', () => (textFieldFocused() ? document.execCommand('undo') : store.undo()));
  onNativeMenu('redo', () => (textFieldFocused() ? document.execCommand('redo') : store.redo()));
  onNativeMenu('save-layout', () => void exportLayoutFile(toast));
  onNativeMenu('open-layout', () => void importLayoutFile(toast));
}

export function buildLayoutsMenu(toast: (msg: string) => void): HTMLElement {
  wireNativeMenu(toast);
  return makeMenu('Layouts', (panel) => {
    panel.appendChild(menuItem('Save current…', '', () => void saveCurrentLayout(toast)));

    const names = persist.listLayouts();
    if (names.length) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      panel.appendChild(sep);
      for (const name of names) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        const loadBtn = menuItem(name, 'load', () => {
          const items = persist.loadLayout(name);
          if (items) {
            store.importItems(items);
            toast(`Loaded “${name}”`);
          }
        });
        loadBtn.style.flex = '1';
        const del = document.createElement('button');
        del.className = 'ui-btn danger row-del';
        del.textContent = '✕';
        del.title = `Delete “${name}”`;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          persist.deleteLayout(name);
          row.remove();
        });
        row.append(loadBtn, del);
        panel.appendChild(row);
      }
    }

    const sep2 = document.createElement('div');
    sep2.className = 'menu-sep';
    panel.appendChild(sep2);
    panel.appendChild(menuItem('Export file…', '.json', () => void exportLayoutFile(toast)));
    panel.appendChild(menuItem('Import file…', '.json', () => void importLayoutFile(toast)));
  });
}
