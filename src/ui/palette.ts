import {
  CHAIR_SEAT_H,
  HEDGE_H,
  ITEM_DIMS,
  ITEM_LABELS,
  LANTERN_SPECS,
  SCREEN_H,
  TABLE_TOPS,
  isLantern,
  isTable,
  setCustomClothDims,
  setCustomTableDims,
} from '../constants';
import type { ItemType } from '../types';
import type { PlacementFSM } from '../interact/placementFSM';
import type { PointerController } from '../interact/pointer';
import { THUMBNAILS } from './thumbnails';

const CARD_TYPES: ItemType[] = [
  'table',
  'tableSq',
  'tableQ',
  'tableC',
  'chair',
  'clothA',
  'clothB',
  'clothC',
  'lantern18',
  'lantern24',
  'lantern30',
  'lantern36',
  'hedge',
  'screen',
  'setting',
  'figureW',
  'figureM',
];

export function buildPalette(
  root: HTMLElement,
  fsm: PlacementFSM,
  pointerCtl: PointerController,
): void {
  const bar = document.createElement('div');
  bar.className = 'palette';
  root.appendChild(bar);

  const prev = document.createElement('button');
  prev.className = 'ui-btn palette-nav';
  prev.textContent = '‹';
  prev.title = 'Previous items';
  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'palette-cards';
  const next = document.createElement('button');
  next.className = 'ui-btn palette-nav';
  next.textContent = '›';
  next.title = 'More items';
  bar.append(prev, cardsWrap, next);

  const cards: HTMLButtonElement[] = [];
  let page = 0;
  const pageSize = (): number => {
    const w = window.innerWidth;
    return w >= 1250 ? 6 : w >= 1000 ? 5 : w >= 800 ? 4 : 3;
  };
  const renderPage = (): void => {
    const n = pageSize();
    const pages = Math.ceil(cards.length / n);
    page = Math.min(page, pages - 1);
    cards.forEach((c, i) => {
      c.style.display = i >= page * n && i < (page + 1) * n ? '' : 'none';
    });
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    prev.style.visibility = pages > 1 ? 'visible' : 'hidden';
    next.style.visibility = pages > 1 ? 'visible' : 'hidden';
  };
  prev.addEventListener('click', () => {
    page = Math.max(0, page - 1);
    renderPage();
  });
  next.addEventListener('click', () => {
    page += 1;
    renderPage();
  });
  window.addEventListener('resize', renderPage);

  // small dims popover for the custom pieces: enter a size, ✓ to start placing
  let pop: HTMLDivElement | null = null;
  const closePop = (): void => {
    pop?.remove();
    pop = null;
  };
  document.addEventListener('pointerdown', (e) => {
    if (pop && !(e.target as HTMLElement).closest('.dim-pop')) closePop();
  });
  const openDimPop = (card: HTMLElement, type: 'clothC' | 'tableC'): void => {
    closePop();
    pop = document.createElement('div');
    pop.className = 'dim-pop';
    const isTableC = type === 'tableC';
    const cur = ITEM_DIMS[type];
    pop.innerHTML = `
      <b>${ITEM_LABELS[type]}</b>
      <div class="dim-pop-row">
        <input type="number" data-k="w" min="18" max="260" step="0.5" value="${cur.w}" title="width (in)"> ×
        <input type="number" data-k="d" min="18" max="260" step="0.5" value="${cur.d}" title="depth (in)">
        ${isTableC ? `× <input type="number" data-k="h" min="24" max="42" step="0.5" value="${TABLE_TOPS.tableC}" title="height (in)">` : ''} in
        <button class="ui-btn dim-ok" title="Use this size and place">✓</button>
      </div>`;
    const rect = card.getBoundingClientRect();
    pop.style.left = `${Math.max(8, rect.left - 40)}px`;
    pop.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    root.appendChild(pop);
    const num = (k: string, lo: number, hi: number, dflt: number): number => {
      const inp = pop!.querySelector(`[data-k="${k}"]`) as HTMLInputElement | null;
      return Math.min(hi, Math.max(lo, Number(inp?.value) || dflt));
    };
    const confirm = (): void => {
      if (isTableC) setCustomTableDims(num('w', 18, 120, 48), num('d', 18, 60, 30), num('h', 24, 42, 30));
      else setCustomClothDims(num('w', 20, 260, 120), num('d', 20, 260, 120));
      const small = card.querySelector('.card-dims');
      if (small) {
        const d2 = ITEM_DIMS[type];
        small.textContent = isTableC ? `${d2.w}" × ${d2.d}" · ${TABLE_TOPS.tableC}"h` : `${d2.w}" × ${d2.d}"`;
      }
      closePop();
      fsm.startPlacing(type); // ghost picks up the fresh dims, places like any item
    };
    (pop.querySelector('.dim-ok') as HTMLButtonElement).addEventListener('click', confirm);
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') closePop();
    });
    (pop.querySelector('[data-k="w"]') as HTMLInputElement).focus();
  };

  for (const type of CARD_TYPES) {
    const card = document.createElement('button');
    card.className = 'palette-card';
    const dims = ITEM_DIMS[type];
    const dimText = isTable(type)
      ? `${dims.w}" × ${dims.d}" · ${TABLE_TOPS[type]}"h`
      : type === 'chair'
        ? `${dims.w}" × ${dims.d}" · ${CHAIR_SEAT_H}" seat`
        : isLantern(type)
          ? `${dims.w}" sq · ${LANTERN_SPECS[type].h}"h · candle`
          : type === 'hedge'
            ? `${dims.w}" × ${dims.d}" · ${HEDGE_H}"h`
            : type === 'screen'
              ? `${dims.w}" × ${dims.d}" · ${SCREEN_H}"h`
              : type === 'setting'
                ? 'Lucca plates + glasses'
          : type === 'figureW' || type === 'figureM'
            ? 'scale reference'
            : `${dims.w}" × ${dims.d}"`;
    card.innerHTML = `${THUMBNAILS[type]}<span class="card-name">${ITEM_LABELS[type]}</span><span class="card-dims">${dimText}</span>`;

    card.addEventListener('pointerdown', (e: PointerEvent) => {
      const start = { x: e.clientX, y: e.clientY };
      let draggedOut = false;
      let panning = false; // horizontal swipe = scroll the palette, not place

      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      const move = (ev: PointerEvent) => {
        if (draggedOut || panning) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (Math.hypot(dx, dy) <= 10) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          panning = true; // let the browser scroll the palette bar
          return;
        }
        if (dy < 0) {
          draggedOut = true;
          const floor = pointerCtl.clientToFloor(ev.clientX, ev.clientY);
          fsm.startPlacing(type, floor ?? undefined);
          // once placing, the PointerController's global move handler drives the ghost
        }
      };
      const up = () => {
        cleanup();
        if (draggedOut) {
          fsm.commit(); // release over the floor: place (or park if invalid)
        } else if (!panning) {
          if (type === 'clothC' || type === 'tableC') {
            openDimPop(card, type); // size first, then place like the others
          } else {
            fsm.startPlacing(type); // plain click: ghost follows the cursor
          }
        }
      };
      const cancel = () => {
        cleanup();
        if (draggedOut) fsm.cancel();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });

    cardsWrap.appendChild(card);
    cards.push(card);
  }
  renderPage();
}
