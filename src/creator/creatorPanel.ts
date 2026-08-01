import { ITEM_DIMS, ITEM_LABELS, TABLE_TOPS, setCustomClothDims, setCustomTableDims, type TableType } from '../constants';
import type { ClothType } from '../cloth/constants';
import { THUMBNAILS } from '../ui/thumbnails';
import { CreatorController, minClothDims, tableCentroid, type CreatorItemType } from './creatorController';

export interface CreatorPanel {
  refresh(): void;
}

const TABLE_CARDS: CreatorItemType[] = ['table', 'tableSq', 'tableQ', 'tableC'];
const EXTRA_CARDS: CreatorItemType[] = ['chair', 'setting'];
const CLOTH_CARDS: ClothType[] = ['clothA', 'clothB', 'clothC'];
const OFFSET_RANGE = 72;

/** Right-hand control column of the Table Setup Creator. */
export function buildCreatorPanel(
  modal: HTMLElement,
  controller: CreatorController,
  actions: { place(): void; close(): void; placeLabel?: string },
): CreatorPanel {
  const col = document.createElement('div');
  col.className = 'creator-col';
  modal.appendChild(col);

  col.innerHTML = `
    <div class="creator-head">
      <h3>Table Setup Creator</h3>
      <button class="ui-btn danger" data-k="close" title="Close (Esc)">✕</button>
    </div>
    <div class="creator-hint">Pick a table, click the bird’s-eye view to place it
      (scroll or R rotates, Del removes). Drop a linen — it centers itself on the
      group; slide it from there.</div>
    <div class="creator-cards" data-k="tables"></div>
    <div class="creator-cards" data-k="extras"></div>
    <div class="creator-cards" data-k="cloths"></div>
    <div class="creator-sec">
      <label>Placed in this set</label>
      <div class="items-list creator-list" data-k="list"></div>
    </div>
    <div class="creator-sec" data-k="customSec">
      <label>Custom linen size</label>
      <div class="creator-row">
        <input type="number" data-k="cw" min="20" max="260" step="1" title="width (in)"> ×
        <input type="number" data-k="cd" min="20" max="260" step="1" title="depth (in)"> in
      </div>
      <label>Custom oak table size</label>
      <div class="creator-row">
        <input type="number" data-k="tw" min="18" max="120" step="0.5" title="width (in)"> ×
        <input type="number" data-k="td" min="18" max="60" step="0.5" title="depth (in)"> ×
        <input type="number" data-k="th" min="24" max="42" step="0.5" title="height (in)"> in
      </div>
    </div>
    <div class="creator-sec">
      <label>Linen offset from table centroid</label>
      <div class="creator-row">
        <span class="axis">Δx</span>
        <input type="range" data-k="sx" min="-${OFFSET_RANGE}" max="${OFFSET_RANGE}" step="0.25" value="0">
        <input type="number" data-k="nx" step="0.25" value="0"> in
      </div>
      <div class="creator-row">
        <span class="axis">Δz</span>
        <input type="range" data-k="sz" min="-${OFFSET_RANGE}" max="${OFFSET_RANGE}" step="0.25" value="0">
        <input type="number" data-k="nz" step="0.25" value="0"> in
      </div>
    </div>
    <div class="creator-info" data-k="minCloth"></div>
    <div class="creator-info" data-k="drape"></div>
    <div class="creator-foot">
      <button class="ui-btn primary" data-k="place"></button>
    </div>`;

  const el = <T extends HTMLElement>(k: string): T => col.querySelector(`[data-k="${k}"]`) as T;
  const cardsTables = el<HTMLDivElement>('tables');
  const cardsExtras = el<HTMLDivElement>('extras');
  const cardsCloths = el<HTMLDivElement>('cloths');
  const listEl = el<HTMLDivElement>('list');
  const cw = el<HTMLInputElement>('cw');
  const cd = el<HTMLInputElement>('cd');
  const tw = el<HTMLInputElement>('tw');
  const td = el<HTMLInputElement>('td');
  const th = el<HTMLInputElement>('th');
  const sx = el<HTMLInputElement>('sx');
  const szEl = el<HTMLInputElement>('sz');
  const nx = el<HTMLInputElement>('nx');
  const nz = el<HTMLInputElement>('nz');
  const minClothEl = el<HTMLDivElement>('minCloth');
  const drapeEl = el<HTMLDivElement>('drape');
  const placeBtn = el<HTMLButtonElement>('place');
  placeBtn.textContent = actions.placeLabel ?? 'Place on floor';

  cw.value = String(ITEM_DIMS.clothC.w);
  cd.value = String(ITEM_DIMS.clothC.d);
  tw.value = String(ITEM_DIMS.tableC.w);
  td.value = String(ITEM_DIMS.tableC.d);
  th.value = String(TABLE_TOPS.tableC);

  const card = (
    parent: HTMLElement,
    type: CreatorItemType | ClothType,
    onClick: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'palette-card creator-card';
    const dims = ITEM_DIMS[type];
    b.innerHTML = `${THUMBNAILS[type]}<span>${ITEM_LABELS[type]}</span><small>${dims.w}" × ${dims.d}"</small>`;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };
  const tableBtns = TABLE_CARDS.map((t) => card(cardsTables, t, () => controller.armTable(t)));
  EXTRA_CARDS.forEach((t) => card(cardsExtras, t, () => controller.armTable(t)));
  const clothBtns = CLOTH_CARDS.map((t) =>
    card(cardsCloths, t, () => {
      // each click adds another linen of this type
      controller.addCloth(t, t === 'clothC' ? { w: clamp(cw), d: clamp(cd) } : null);
    }),
  );

  const clamp = (input: HTMLInputElement): number =>
    Math.min(260, Math.max(20, Math.round(Number(input.value) || 120)));

  const applyCustom = (): void => {
    const w = clamp(cw);
    const d = clamp(cd);
    cw.value = String(w);
    cd.value = String(d);
    setCustomClothDims(w, d);
    // resizing updates the ACTIVE custom linen (others keep their stamp)
    const active = controller.activeCloth();
    if (active?.type === 'clothC') {
      active.dims = { w, d };
      controller.sync();
    }
    refresh();
  };
  cw.addEventListener('change', applyCustom);
  cd.addEventListener('change', applyCustom);
  const applyCustomTable = (): void => {
    const clampV = (inp: HTMLInputElement, lo: number, hi: number, dflt: number): number =>
      Math.min(hi, Math.max(lo, Number(inp.value) || dflt));
    const w = clampV(tw, 18, 120, 48);
    const d = clampV(td, 18, 60, 30);
    const h = clampV(th, 24, 42, 30);
    tw.value = String(w);
    td.value = String(d);
    th.value = String(h);
    setCustomTableDims(w, d, h);
    // re-stamp the selected custom table (others keep their stamp)
    const sel = controller.state.tables.find((t) => t.id === controller.selectedId && t.type === 'tableC');
    if (sel) {
      sel.dims = { w, d, h };
      controller.sync();
    }
    refresh();
  };
  tw.addEventListener('change', applyCustomTable);
  td.addEventListener('change', applyCustomTable);
  th.addEventListener('change', applyCustomTable);

  const curOffset = (): { dx: number; dz: number } => controller.activeCloth()?.offset ?? { dx: 0, dz: 0 };
  const setOffset = (dx: number, dz: number): void => {
    const cl = (v: number): number => Math.min(OFFSET_RANGE, Math.max(-OFFSET_RANGE, v));
    controller.setOffset(cl(dx), cl(dz));
  };
  sx.addEventListener('input', () => setOffset(Number(sx.value), curOffset().dz));
  szEl.addEventListener('input', () => setOffset(curOffset().dx, Number(szEl.value)));
  nx.addEventListener('change', () => setOffset(Number(nx.value) || 0, curOffset().dz));
  nz.addEventListener('change', () => setOffset(curOffset().dx, Number(nz.value) || 0));

  el<HTMLButtonElement>('close').addEventListener('click', actions.close);
  placeBtn.addEventListener('click', actions.place);

  const refresh = (): void => {
    const st = controller.state;
    const active = controller.activeCloth();
    const { dx, dz } = active?.offset ?? { dx: 0, dz: 0 };
    if (document.activeElement !== sx) sx.value = String(dx);
    if (document.activeElement !== szEl) szEl.value = String(dz);
    if (document.activeElement !== nx) nx.value = String(dx);
    if (document.activeElement !== nz) nz.value = String(dz);
    const hasCloth = !!active && st.tables.length > 0;
    for (const input of [sx, szEl, nx, nz]) input.disabled = !hasCloth;

    clothBtns.forEach((b, i) => {
      if (CLOTH_CARDS[i] === 'clothC') {
        const small = b.querySelector('small');
        if (small) small.textContent = `${ITEM_DIMS.clothC.w}" × ${ITEM_DIMS.clothC.d}"`;
      }
    });
    tableBtns.forEach((b, i) => {
      if (TABLE_CARDS[i] === 'tableC') {
        const small = b.querySelector('small');
        if (small)
          small.textContent = `${ITEM_DIMS.tableC.w}" × ${ITEM_DIMS.tableC.d}" · ${TABLE_TOPS.tableC}"h`;
      }
    });

    // placed list: click a row to re-adjust that item (cloths bind the
    // offset/hem controls; solids highlight + drag in the bird's-eye)
    listEl.innerHTML = '';
    const counters = new Map<string, number>();
    for (const it of controller.items()) {
      const n = (counters.get(it.type) ?? 0) + 1;
      counters.set(it.type, n);
      const row = document.createElement('div');
      const isActive = it.id === controller.selectedId || it.id === controller.activeClothId;
      row.className = 'item-row' + (isActive ? ' selected' : '');
      const label = document.createElement('button');
      label.className = 'item-label';
      label.textContent = `${ITEM_LABELS[it.type]} ${n}`;
      label.addEventListener('click', () => controller.selectItem(it.id));
      const del = document.createElement('button');
      del.className = 'ui-btn danger row-del';
      del.textContent = '✕';
      del.addEventListener('click', () => controller.removeItem(it.id));
      row.append(label, del);
      listEl.appendChild(row);
    }

    const min = minClothDims(st.tables);
    if (min) {
      const h = Math.max(...st.tables.map((t) => TABLE_TOPS[t.type as TableType]));
      minClothEl.innerHTML = `<b>Floor-length needs ≥ ${min.w}" × ${min.d}"</b><br>
        <small>group ${Math.round(min.w - 2 * h)}" × ${Math.round(min.d - 2 * h)}" + 2 × ${h}" drop</small>`;
    } else {
      minClothEl.innerHTML = '<small>Place a table to see the minimum linen size.</small>';
    }

    const report = controller.drapeReport();
    if (report && hasCloth && active) {
      const c = tableCentroid(st.tables);
      const idx = st.cloths.findIndex((cl) => cl.id === active.id) + 1;
      drapeEl.innerHTML =
        `<b>${ITEM_LABELS[active.type]} ${idx}: ${fmtOff(dx)}", ${fmtOff(dz)}" from tables (${c.x.toFixed(0)}, ${c.z.toFixed(0)})</b><br>` +
        report.sides.map((s) => `<small>${s.label}: ${s.text}</small>`).join('<br>');
    } else {
      drapeEl.innerHTML = '';
    }

    placeBtn.disabled = st.tables.length === 0;
  };
  refresh();
  return { refresh };
}

const fmtOff = (v: number): string => (v >= 0 ? `+${v}` : `${v}`);
