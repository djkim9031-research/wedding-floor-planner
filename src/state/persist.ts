import type { LayoutFile, PlacedItem } from '../types';

const AUTOSAVE_KEY = 'wp:autosave';
const LAYOUTS_KEY = 'wp:layouts';

const TYPES = new Set([
  'table',
  'tableSq',
  'tableQ',
  'chair',
  'clothA',
  'clothB',
  'figureW',
  'figureM',
]);

function isValidItem(it: unknown): it is PlacedItem {
  if (typeof it !== 'object' || it === null) return false;
  const o = it as Record<string, unknown>;
  if (o.type === 'figure') o.type = 'figureM'; // pre-two-figure saves
  return (
    typeof o.id === 'string' &&
    TYPES.has(o.type as string) &&
    Number.isFinite(o.x) &&
    Number.isFinite(o.z) &&
    Number.isFinite(o.yawDeg)
  );
}

export function parseLayout(text: string): PlacedItem[] | null {
  try {
    const data = JSON.parse(text) as LayoutFile;
    if (data.version !== 1 || !Array.isArray(data.items)) return null;
    if (!data.items.every(isValidItem)) return null;
    return data.items;
  } catch {
    return null;
  }
}

function makeFile(items: PlacedItem[], name?: string): LayoutFile {
  return { version: 1, name, savedAt: new Date().toISOString(), items };
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export function autosave(items: PlacedItem[]): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(makeFile(items)));
    } catch {
      /* storage unavailable — ignore */
    }
  }, 500);
}

export function loadAutosave(): PlacedItem[] | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseLayout(text) : null;
  } catch {
    return null;
  }
}

export function listLayouts(): string[] {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    return raw ? Object.keys(JSON.parse(raw) as Record<string, LayoutFile>) : [];
  } catch {
    return [];
  }
}

export function saveLayout(name: string, items: PlacedItem[]): void {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, LayoutFile>) : {};
    all[name] = makeFile(items, name);
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function loadLayout(name: string): PlacedItem[] | null {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, LayoutFile>;
    const file = all[name];
    return file && file.items.every(isValidItem) ? file.items : null;
  } catch {
    return null;
  }
}

export function deleteLayout(name: string): void {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, LayoutFile>;
    delete all[name];
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function exportLayout(items: PlacedItem[], name = 'wedding-layout'): void {
  const blob = new Blob([JSON.stringify(makeFile(items, name), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function importLayoutFile(file: File): Promise<PlacedItem[] | null> {
  return file.text().then(parseLayout);
}
