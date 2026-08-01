import { ITEM_DIMS, ITEM_LABELS, TABLE_TOPS, setCustomClothDims, type TableType } from '../constants';
import type { ClothType } from '../cloth/constants';
import { THUMBNAILS } from '../ui/thumbnails';
import { CreatorController, minClothDims, tableCentroid, type CreatorItemType } from './creatorController';

export interface CreatorPanel {
  refresh(): void;
}

const TABLE_CARDS: CreatorItemType[] = ['table', 'tableSq', 'tableQ'];
const EXTRA_CARDS: CreatorItemType[] = ['chair', 'setting'];
const CLOTH_CARDS: ClothType[] = ['clothA', 'clothB', 'clothC'];
const OFFSET_RANGE = 72;

/** Right-hand control column of the Table Setup Creator. */
export function buildCreatorPanel(
  modal: HTMLElement,
  controller: CreatorController,
  actions: { place(): void; close(): void },
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
    <div class="creator-sec" data-k="customSec">
      <label>Custom linen size</label>
      <div class="creator-row">
        <input type="number" data-k="cw" min="20" max="260" step="1" title="width (in)"> ×
        <input type="number" data-k="cd" min="20" max="260" step="1" title="depth (in)"> in
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
      <button class="ui-btn primary" data-k="place">Place on floor</button>
    </div>`;

  const el = <T extends HTMLElement>(k: string): T => col.querySelector(`[data-k="${k}"]`) as T;
  const cardsTables = el<HTMLDivElement>('tables');
  const cardsExtras = el<HTMLDivElement>('extras');
  const cardsCloths = el<HTMLDivElement>('cloths');
  const cw = el<HTMLInputElement>('cw');
  const cd = el<HTMLInputElement>('cd');
  const sx = el<HTMLInputElement>('sx');
  const szEl = el<HTMLInputElement>('sz');
  const nx = el<HTMLInputElement>('nx');
  const nz = el<HTMLInputElement>('nz');
  const minClothEl = el<HTMLDivElement>('minCloth');
  const drapeEl = el<HTMLDivElement>('drape');
  const placeBtn = el<HTMLButtonElement>('place');

  cw.value = String(ITEM_DIMS.clothC.w);
  cd.value = String(ITEM_DIMS.clothC.d);

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
      const already = controller.state.clothType === t;
      controller.setCloth(
        already ? null : t,
        t === 'clothC' ? { w: clamp(cw), d: clamp(cd) } : null,
      );
    }),
  );
  void tableBtns;

  const clamp = (input: HTMLInputElement): number =>
    Math.min(260, Math.max(20, Math.round(Number(input.value) || 120)));

  const applyCustom = (): void => {
    const w = clamp(cw);
    const d = clamp(cd);
    cw.value = String(w);
    cd.value = String(d);
    setCustomClothDims(w, d);
    if (controller.state.clothType === 'clothC') controller.setCloth('clothC', { w, d });
    refresh();
  };
  cw.addEventListener('change', applyCustom);
  cd.addEventListener('change', applyCustom);

  const setOffset = (dx: number, dz: number): void => {
    const cl = (v: number): number => Math.min(OFFSET_RANGE, Math.max(-OFFSET_RANGE, v));
    controller.setOffset(cl(dx), cl(dz));
  };
  sx.addEventListener('input', () => setOffset(Number(sx.value), controller.state.offset.dz));
  szEl.addEventListener('input', () => setOffset(controller.state.offset.dx, Number(szEl.value)));
  nx.addEventListener('change', () => setOffset(Number(nx.value) || 0, controller.state.offset.dz));
  nz.addEventListener('change', () => setOffset(controller.state.offset.dx, Number(nz.value) || 0));

  el<HTMLButtonElement>('close').addEventListener('click', actions.close);
  placeBtn.addEventListener('click', actions.place);

  const refresh = (): void => {
    const st = controller.state;
    const { dx, dz } = st.offset;
    if (document.activeElement !== sx) sx.value = String(dx);
    if (document.activeElement !== szEl) szEl.value = String(dz);
    if (document.activeElement !== nx) nx.value = String(dx);
    if (document.activeElement !== nz) nz.value = String(dz);
    const hasCloth = !!st.clothType && st.tables.length > 0;
    for (const input of [sx, szEl, nx, nz]) input.disabled = !hasCloth;

    clothBtns.forEach((b, i) => {
      b.classList.toggle('active', st.clothType === CLOTH_CARDS[i]);
      // keep the custom card's size label current
      if (CLOTH_CARDS[i] === 'clothC') {
        const small = b.querySelector('small');
        if (small) small.textContent = `${ITEM_DIMS.clothC.w}" × ${ITEM_DIMS.clothC.d}"`;
      }
    });

    const min = minClothDims(st.tables);
    if (min) {
      const h = Math.max(...st.tables.map((t) => TABLE_TOPS[t.type as TableType]));
      minClothEl.innerHTML = `<b>Floor-length needs ≥ ${min.w}" × ${min.d}"</b><br>
        <small>group ${Math.round(min.w - 2 * h)}" × ${Math.round(min.d - 2 * h)}" + 2 × ${h}" drop</small>`;
    } else {
      minClothEl.innerHTML = '<small>Place a table to see the minimum linen size.</small>';
    }

    const report = controller.drapeReport();
    if (report && hasCloth) {
      const c = tableCentroid(st.tables);
      drapeEl.innerHTML =
        `<b>Linen centroid: ${fmtOff(dx)}", ${fmtOff(dz)}" from tables (${c.x.toFixed(0)}, ${c.z.toFixed(0)})</b><br>` +
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
