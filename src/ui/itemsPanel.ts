import { ITEM_LABELS } from '../constants';
import * as store from '../state/store';
import type { PlacementFSM } from '../interact/placementFSM';

export interface ItemsPanel {
  refresh(): void;
}

/** Right-hand inventory: every placed item, selectable and deletable. */
export function buildItemsPanel(root: HTMLElement, fsm: PlacementFSM): ItemsPanel {
  const panel = document.createElement('div');
  panel.className = 'items-panel';
  root.appendChild(panel);

  const refresh = (): void => {
    const s = store.getState();
    panel.innerHTML = '';
    if (!s.items.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';

    const head = document.createElement('div');
    head.className = 'items-head';
    const title = document.createElement('span');
    const nSel = s.selectedIds.length;
    title.textContent = nSel > 1 ? `Placed (${s.items.length}) · ${nSel} selected` : `Placed (${s.items.length})`;
    const delAll = document.createElement('button');
    delAll.className = 'ui-btn danger';
    delAll.textContent = 'Delete all';
    delAll.addEventListener('click', () => {
      fsm.cancel();
      store.clearAll();
    });
    head.append(title, delAll);
    panel.appendChild(head);

    const list = document.createElement('div');
    list.className = 'items-list';
    const counters = new Map<string, number>();
    for (const it of s.items) {
      const n = (counters.get(it.type) ?? 0) + 1;
      counters.set(it.type, n);
      const row = document.createElement('div');
      const locked = fsm.lockedId === it.id;
      row.className = 'item-row' + (s.selectedIds.includes(it.id) ? ' selected' : '');
      const label = document.createElement('button');
      label.className = 'item-label';
      label.textContent = `${ITEM_LABELS[it.type]} ${n}${locked ? ' 🔒' : ''}`;
      label.title = locked
        ? 'Locked — drag or use arrow keys to move it; Esc unlocks'
        : 'Select and lock: only this item moves until Esc';
      label.addEventListener('click', () => {
        if (fsm.lockedId === it.id) {
          // clicking the locked row again releases it
          fsm.unlock();
          store.select(null);
          return;
        }
        fsm.lock(it.id);
      });
      const del = document.createElement('button');
      del.className = 'ui-btn danger row-del';
      del.textContent = '✕';
      del.title = `Delete ${ITEM_LABELS[it.type]} ${n}`;
      del.addEventListener('click', () => {
        if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
        if (fsm.lockedId === it.id) fsm.unlock();
        store.deleteItem(it.id);
      });
      row.append(label, del);
      list.appendChild(row);
    }
    panel.appendChild(list);
  };
  refresh();
  return { refresh };
}
