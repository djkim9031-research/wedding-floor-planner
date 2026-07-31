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
    title.textContent = `Placed (${s.items.length})`;
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
      row.className = 'item-row' + (it.id === s.selectedId ? ' selected' : '');
      const label = document.createElement('button');
      label.className = 'item-label';
      label.textContent = `${ITEM_LABELS[it.type]} ${n}`;
      label.addEventListener('click', () => {
        if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
        store.select(it.id === store.getState().selectedId ? null : it.id);
      });
      const del = document.createElement('button');
      del.className = 'ui-btn danger row-del';
      del.textContent = '✕';
      del.title = `Delete ${ITEM_LABELS[it.type]} ${n}`;
      del.addEventListener('click', () => {
        if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
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
