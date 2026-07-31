import { PRESETS } from '../constants';
import type { AppState, GhostState, ItemType, PlacedItem, Pose, Settings, ViewMode } from '../types';
import * as history from './history';

export type StoreEventKind = 'items' | 'ghost' | 'selection' | 'settings' | 'view' | 'load';

export interface StoreEvent {
  kind: StoreEventKind;
  /** ids whose pose/existence changed (for targeted cloth re-simulation) */
  changedIds?: string[];
}

let seq = 0;
export const uid = (): string => `i${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;

const state: AppState = {
  items: [],
  settings: { gridSnap: false, angleSnap: true, magnetSnap: true, showDims: true },
  selectedId: null,
  ghost: null,
  viewMode: 'orbit',
};

type Listener = (s: AppState, ev: StoreEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(ev: StoreEvent): void {
  for (const fn of listeners) fn(state, ev);
}

export const getState = (): AppState => state;

// --- transient state (not undoable) ---------------------------------------

export function setGhost(ghost: GhostState | null): void {
  state.ghost = ghost;
  emit({ kind: 'ghost' });
}

export function select(id: string | null): void {
  if (state.selectedId === id) return;
  state.selectedId = id;
  emit({ kind: 'selection' });
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  state.settings[key] = value;
  emit({ kind: 'settings' });
}

export function setViewMode(mode: ViewMode): void {
  state.viewMode = mode;
  emit({ kind: 'view' });
}

// --- committed mutations (undoable) ----------------------------------------

export function placeItem(type: ItemType, pose: Pose): PlacedItem {
  history.push(state.items);
  const item: PlacedItem = { id: uid(), type, ...pose };
  state.items = [...state.items, item];
  emit({ kind: 'items', changedIds: [item.id] });
  return item;
}

export function moveItem(id: string, pose: Pose): void {
  const cur = state.items.find((it) => it.id === id);
  if (!cur || (cur.x === pose.x && cur.z === pose.z && cur.yawDeg === pose.yawDeg)) return;
  history.push(state.items);
  state.items = state.items.map((it) => (it.id === id ? { ...it, ...pose } : it));
  emit({ kind: 'items', changedIds: [id] });
}

export function deleteItem(id: string): void {
  if (!state.items.some((it) => it.id === id)) return;
  history.push(state.items);
  state.items = state.items.filter((it) => it.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  emit({ kind: 'items', changedIds: [id] });
}

export function clearAll(): void {
  if (!state.items.length) return;
  history.push(state.items);
  const ids = state.items.map((it) => it.id);
  state.items = [];
  state.selectedId = null;
  emit({ kind: 'items', changedIds: ids });
}

export function applyPreset(name: string): void {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) return;
  history.push(state.items);
  const ids: string[] = [...state.items.map((it) => it.id)];
  state.items = preset.items.map((it) => ({ id: uid(), ...it }));
  ids.push(...state.items.map((it) => it.id));
  state.selectedId = null;
  emit({ kind: 'items', changedIds: ids });
}

export function importItems(items: PlacedItem[]): void {
  history.push(state.items);
  const ids = [...state.items.map((it) => it.id), ...items.map((it) => it.id)];
  state.items = items.map((it) => ({ ...it }));
  state.selectedId = null;
  emit({ kind: 'load', changedIds: ids });
}

export function undo(): void {
  const prev = history.undo(state.items);
  if (!prev) return;
  const ids = diffIds(state.items, prev);
  state.items = prev;
  if (state.selectedId && !prev.some((it) => it.id === state.selectedId)) state.selectedId = null;
  emit({ kind: 'items', changedIds: ids });
}

export function redo(): void {
  const next = history.redo(state.items);
  if (!next) return;
  const ids = diffIds(state.items, next);
  state.items = next;
  if (state.selectedId && !next.some((it) => it.id === state.selectedId)) state.selectedId = null;
  emit({ kind: 'items', changedIds: ids });
}

function diffIds(a: PlacedItem[], b: PlacedItem[]): string[] {
  const ids = new Set<string>();
  const bMap = new Map(b.map((it) => [it.id, it]));
  for (const it of a) {
    const other = bMap.get(it.id);
    if (!other || other.x !== it.x || other.z !== it.z || other.yawDeg !== it.yawDeg) ids.add(it.id);
    bMap.delete(it.id);
  }
  for (const id of bMap.keys()) ids.add(id);
  return [...ids];
}

export const canUndo = history.canUndo;
export const canRedo = history.canRedo;
