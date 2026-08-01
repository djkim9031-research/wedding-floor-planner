import { ITEM_LABELS } from '../constants';
import * as store from '../state/store';
import type { PlacementFSM } from '../interact/placementFSM';

export interface ItemsPanel {
  refresh(): void;
}

/** Right-hand inventory: every placed item, selectable and deletable. */
export function buildItemsPanel(
  root: HTMLElement,
  fsm: PlacementFSM,
  onEditSet?: (label: string) => void,
): ItemsPanel {
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
    const seenSets = new Set<string>();
    for (const it of s.items) {
      // one header per named set, ahead of its first member
      if (it.set && !seenSets.has(it.set)) {
        seenSets.add(it.set);
        const setLabel = it.set;
        const members = s.items.filter((m) => m.set === setLabel);
        const header = document.createElement('div');
        header.className =
          'item-row set-head' +
          (members.every((m) => s.selectedIds.includes(m.id)) ? ' selected' : '');
        const hBtn = document.createElement('button');
        hBtn.className = 'item-label';
        hBtn.textContent = `▣ ${setLabel}`;
        hBtn.title = 'Select the whole set';
        hBtn.addEventListener('click', () => {
          if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
          fsm.unlock();
          store.selectGroup(members.map((m) => m.id));
        });
        if (onEditSet) {
          const hEdit = document.createElement('button');
          hEdit.className = 'ui-btn row-del set-edit';
          hEdit.textContent = '✎';
          hEdit.title = `Edit ${setLabel} in the Table Setup Creator`;
          hEdit.addEventListener('click', () => {
            if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
            onEditSet(setLabel);
          });
          header.append(hEdit);
        }
        const hDel = document.createElement('button');
        hDel.className = 'ui-btn danger row-del';
        hDel.textContent = '✕';
        hDel.title = `Delete ${setLabel}`;
        hDel.addEventListener('click', () => {
          if (fsm.state !== 'idle' && fsm.state !== 'selected') fsm.cancel();
          store.deleteItems(members.map((m) => m.id));
        });
        header.append(hBtn, hDel);
        list.appendChild(header);
      }
      const n = (counters.get(it.type) ?? 0) + 1;
      counters.set(it.type, n);
      const row = document.createElement('div');
      const locked = fsm.lockedId === it.id;
      row.className =
        'item-row' +
        (s.selectedIds.includes(it.id) ? ' selected' : '') +
        (it.set ? ' in-set' : '');
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
