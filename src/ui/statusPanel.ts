import { HEDGE_H, ITEM_DIMS, ITEM_LABELS, LANTERN_SPECS, SCREEN_H, TABLE_TOPS, isLantern, isTable } from '../constants';
import { fmtInches } from '../core/format';
import * as store from '../state/store';
import type { DrapeReport, PlacedItem, Pose } from '../types';
import type { PlacementFSM } from '../interact/placementFSM';

export interface DrapeSource {
  getReport(id: string): DrapeReport | null;
  predict(type: 'clothA' | 'clothB', pose: Pose, tables: PlacedItem[]): DrapeReport;
}

export interface StatusPanel {
  refresh(): void;
}

const isCloth = (t: string): t is 'clothA' | 'clothB' => t === 'clothA' || t === 'clothB';

const coarsePointer =
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function buildStatusPanel(
  root: HTMLElement,
  fsm: PlacementFSM,
  drapes: DrapeSource,
): StatusPanel {
  const panel = document.createElement('div');
  panel.className = 'status-panel';
  root.appendChild(panel);

  const drapeList = (report: DrapeReport, predicted: boolean): string => {
    if (report.onFloorOnly) {
      return `<div class="drape-note">Laid flat on the floor</div>`;
    }
    const rows = report.sides
      .map(
        (s) =>
          `<li><span class="side">${s.label}</span><span class="val">${s.text}</span></li>`,
      )
      .join('');
    const note = predicted
      ? `<div class="drape-note">estimated — settles on placement</div>`
      : report.bridgesBlocks
        ? `<div class="drape-note">spans two separate table groups</div>`
        : '';
    return `<ul class="drape-list">${rows}</ul>${note}`;
  };

  const actionButtons = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'sel-actions';
    const mk = (label: string, title: string, fn: () => void, cls = '') => {
      const b = document.createElement('button');
      b.className = `ui-btn ${cls}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    };
    mk('⟲', 'Rotate −15° (Shift+R)', () => fsm.rotateBy(-15));
    mk('⟳', 'Rotate +15° (R)', () => fsm.rotateBy(15));
    mk('Duplicate', 'Ctrl+D', () => fsm.duplicateSelected());
    mk('Delete', 'Del', () => fsm.deleteSelected(), 'danger');
    return wrap;
  };

  let lastGhostKey = '';
  const refresh = (): void => {
    const s = store.getState();
    const ghost = s.ghost;
    // ghost moves arrive per pointer-move: skip identical rebuilds (2" grid)
    const key = ghost
      ? `${ghost.type}|${Math.round(ghost.x / 2)}|${Math.round(ghost.z / 2)}|${Math.round(
          ghost.yawDeg,
        )}|${ghost.valid}|${ghost.snapped ? 1 : 0}|${ghost.parked ? 1 : 0}`
      : '';
    if (ghost && key === lastGhostKey) return;
    lastGhostKey = key;
    panel.innerHTML = '';

    if (ghost?.parked) {
      panel.innerHTML = `<h3>${ITEM_LABELS[ghost.type]}</h3>
        <div class="sub">${ghost.valid ? 'Ready to place' : 'Move it clear of walls & tables'}</div>`;
      const wrap = document.createElement('div');
      wrap.className = 'parked-actions';
      const ok = document.createElement('button');
      ok.className = 'ui-btn confirm';
      ok.textContent = '✓ Place';
      ok.disabled = !ghost.valid;
      ok.addEventListener('click', () => fsm.confirmParked());
      const no = document.createElement('button');
      no.className = 'ui-btn cancel';
      no.textContent = '✕';
      no.addEventListener('click', () => fsm.cancel());
      wrap.append(ok, no);
      panel.appendChild(wrap);
      return;
    }

    if (ghost) {
      const dims = ITEM_DIMS[ghost.type];
      let html = `<h3>${ITEM_LABELS[ghost.type]}</h3>
        <div class="sub">${fmtInches(dims.w)}" × ${fmtInches(dims.d)}" · ${Math.round(ghost.yawDeg)}°${
          ghost.snapped ? ' · snapped' : ''
        }</div>`;
      if (isCloth(ghost.type)) {
        const tables = s.items.filter((it) => isTable(it.type));
        const report = drapes.predict(ghost.type, ghost, tables);
        html += drapeList(report, true);
      }
      html += coarsePointer
        ? `<div class="hint">Tap the floor to place · drag to position</div>`
        : `<div class="hint">Click to place · scroll or R to rotate · Esc to cancel</div>`;
      panel.innerHTML = html;
      const no = document.createElement('button');
      no.className = 'ui-btn cancel';
      no.textContent = '✕ Cancel';
      no.style.marginTop = '8px';
      no.addEventListener('click', () => fsm.cancel());
      panel.appendChild(no);
      return;
    }

    const sel = s.items.find((it) => it.id === s.selectedId);
    if (sel) {
      const dims = ITEM_DIMS[sel.type];
      const height = isTable(sel.type)
        ? ` · ${fmtInches(TABLE_TOPS[sel.type])}"h`
        : isLantern(sel.type)
          ? ` · ${LANTERN_SPECS[sel.type].h}"h · ~13 lm`
          : sel.type === 'hedge'
            ? ` · ${HEDGE_H}"h`
            : sel.type === 'screen'
              ? ` · ${SCREEN_H}"h`
              : '';
      let html = `<h3>${ITEM_LABELS[sel.type]}</h3>
        <div class="sub">${fmtInches(dims.w)}" × ${fmtInches(dims.d)}"${height} · ${Math.round(sel.yawDeg)}°</div>`;
      if (isCloth(sel.type)) {
        const report = drapes.getReport(sel.id);
        if (report) {
          html += drapeList(report, false);
        } else {
          html += `<div class="drape-note">settling…</div>`;
        }
      }
      panel.innerHTML = html;
      panel.appendChild(actionButtons());
      return;
    }

    panel.innerHTML = `<h3>Open Space</h3>
      <div class="sub">45'-5" × 49'-11" · 2,189 ft²</div>
      <div class="hint">Pick an item below and click to place it.<br>
      Drag tables together to snap them into one block, then drop a linen on top to see the drape.<br>
      <b>T</b> plan view · <b>V</b> stand in the room</div>`;
  };

  refresh();
  return { refresh };
}
