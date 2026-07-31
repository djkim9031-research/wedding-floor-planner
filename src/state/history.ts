import type { PlacedItem } from '../types';

const MAX = 100;

const clone = (items: PlacedItem[]): PlacedItem[] => items.map((it) => ({ ...it }));

let past: PlacedItem[][] = [];
let future: PlacedItem[][] = [];

/** Record the state as it was BEFORE a mutation. */
export function push(items: PlacedItem[]): void {
  past.push(clone(items));
  if (past.length > MAX) past.shift();
  future = [];
}

export function undo(current: PlacedItem[]): PlacedItem[] | null {
  const prev = past.pop();
  if (!prev) return null;
  future.push(clone(current));
  return prev;
}

export function redo(current: PlacedItem[]): PlacedItem[] | null {
  const next = future.pop();
  if (!next) return null;
  past.push(clone(current));
  return next;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
