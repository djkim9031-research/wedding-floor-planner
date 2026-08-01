import * as THREE from 'three';
import { ITEM_DIMS, TABLE_TOPS, type TableType } from '../constants';
import type { PlacedItem } from '../types';
import { CreatorController, tableBBox, tableCentroid } from './creatorController';
import { buildCreatorPanel } from './creatorPanel';
import { createStudioScene } from './studioScene';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let openInstance: { close: () => void } | null = null;

/** The Table Setup Creator: a modal drape-design studio covering 90% of the
 * window. Center = bird's-eye placement; four orthographic elevations show
 * each face floor-to-tabletop; the cloth stays locked to the table-group
 * centroid plus a slider/numeric offset. `onPlace` receives the design
 * (centroid-relative poses) when the user hits Place. */
export function openCreator(onPlace: (design: Omit<PlacedItem, 'id'>[]) => void): void {
  if (openInstance) return;

  const overlay = document.createElement('div');
  overlay.className = 'creator-overlay';
  const modal = document.createElement('div');
  modal.className = 'creator-modal';
  overlay.appendChild(modal);

  const viewsWrap = document.createElement('div');
  viewsWrap.className = 'creator-views';
  const canvas = document.createElement('canvas');
  viewsWrap.appendChild(canvas);
  const labels: Record<string, HTMLDivElement> = {};
  for (const key of ['N', 'S', 'W', 'E', 'top'] as const) {
    const el = document.createElement('div');
    el.className = 'creator-view-label';
    el.textContent =
      key === 'top'
        ? 'bird’s eye'
        : { N: 'north face', S: 'south face', W: 'west face', E: 'east face' }[key];
    labels[key] = el;
    viewsWrap.appendChild(el);
  }
  const hems: Record<'N' | 'E' | 'S' | 'W', { row: HTMLDivElement; slider: HTMLInputElement; val: HTMLSpanElement }> = {} as never;
  for (const key of ['N', 'E', 'S', 'W'] as const) {
    const row = document.createElement('div');
    row.className = 'creator-hem';
    const cap = document.createElement('span');
    cap.textContent = 'hem';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '30';
    slider.step = '0.25';
    const val = document.createElement('span');
    val.className = 'hem-val';
    row.append(cap, slider, val);
    viewsWrap.appendChild(row);
    hems[key] = { row, slider, val };
  }
  modal.appendChild(viewsWrap);
  document.body.appendChild(overlay);

  const studio = createStudioScene();
  const controller = new CreatorController(studio.itemsGroup, studio.overlayGroup);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---- viewport layout: four wide elevation strips stacked on the left,
  // the bird's-eye placement view on the right ----
  let rects: Record<'top' | 'N' | 'S' | 'W' | 'E', Rect> | null = null;
  const layout = (): void => {
    const W = viewsWrap.clientWidth;
    const H = viewsWrap.clientHeight;
    renderer.setSize(W, H, false);
    const gap = 8;
    const centerSize = Math.min(H - 2 * gap, Math.round(W * 0.55));
    const leftW = W - centerSize - 3 * gap;
    const stripH = Math.round((H - 5 * gap) / 4);
    const cy0 = Math.round((H - centerSize) / 2);
    const strip = (i: number): Rect => ({ x: gap, y: gap + i * (stripH + gap), w: leftW, h: stripH });
    rects = {
      N: strip(0),
      E: strip(1),
      S: strip(2),
      W: strip(3),
      top: { x: leftW + 2 * gap, y: cy0, w: centerSize, h: centerSize },
    };
    for (const key of ['N', 'S', 'W', 'E', 'top'] as const) {
      const r = rects[key];
      labels[key].style.cssText = `left:${r.x + 6}px;top:${r.y + 4}px;`;
      if (key !== 'top') {
        const h = hems[key];
        h.row.style.cssText = `left:${r.x + r.w - 218}px;top:${r.y + r.h - 30}px;width:210px;`;
      }
    }
    reframe();
  };

  const reframe = (): void => {
    if (!rects) return;
    studio.frame(tableBBox(controller.state.tables), {
      top: 1,
      N: rects.N.w / rects.N.h,
      S: rects.S.w / rects.S.h,
      W: rects.W.w / rects.W.h,
      E: rects.E.w / rects.E.h,
    });
  };
  /** geometric hem gap (inches above floor) for each face; null = no cloth */
  const hemState = (): {
    h: number;
    gaps: Record<'N' | 'E' | 'S' | 'W', number>;
  } | null => {
    const st = controller.state;
    const b = tableBBox(st.tables);
    if (!b || !st.clothType) return null;
    const dims = st.clothType === 'clothC' && st.clothDims ? st.clothDims : ITEM_DIMS[st.clothType];
    const c = tableCentroid(st.tables);
    const cx = c.x + st.offset.dx;
    const cz = c.z + st.offset.dz;
    const h = Math.max(...st.tables.map((t) => TABLE_TOPS[t.type as TableType]));
    const clampG = (drop: number): number => Math.min(h, Math.max(0, h - drop));
    return {
      h,
      gaps: {
        N: clampG(b.minZ - (cz - dims.d / 2)),
        S: clampG(cz + dims.d / 2 - b.maxZ),
        W: clampG(b.minX - (cx - dims.w / 2)),
        E: clampG(cx + dims.w / 2 - b.maxX),
      },
    };
  };

  const refreshHems = (): void => {
    const hs = hemState();
    for (const key of ['N', 'E', 'S', 'W'] as const) {
      const ui = hems[key];
      ui.row.style.display = hs ? 'flex' : 'none';
      if (!hs) continue;
      ui.slider.max = String(hs.h);
      if (document.activeElement !== ui.slider) ui.slider.value = String(hs.gaps[key]);
      ui.val.textContent = hs.gaps[key] <= 0.01 ? 'floor' : `${hs.gaps[key].toFixed(2)}" up`;
    }
  };

  /** pulling one face's hem slides the cloth — the opposite face follows */
  const setHem = (face: 'N' | 'E' | 'S' | 'W', gap: number): void => {
    const st = controller.state;
    const b = tableBBox(st.tables);
    if (!b || !st.clothType) return;
    const dims = st.clothType === 'clothC' && st.clothDims ? st.clothDims : ITEM_DIMS[st.clothType];
    const c = tableCentroid(st.tables);
    const h = Math.max(...st.tables.map((t) => TABLE_TOPS[t.type as TableType]));
    const drop = h - Math.min(h, Math.max(0, gap));
    let { dx, dz } = st.offset;
    if (face === 'E') dx = b.maxX + drop - dims.w / 2 - c.x;
    else if (face === 'W') dx = b.minX - drop + dims.w / 2 - c.x;
    else if (face === 'S') dz = b.maxZ + drop - dims.d / 2 - c.z;
    else dz = b.minZ - drop + dims.d / 2 - c.z;
    const cl = (v: number): number => Math.min(72, Math.max(-72, v));
    controller.setOffset(cl(dx), cl(dz));
  };
  for (const key of ['N', 'E', 'S', 'W'] as const) {
    hems[key].slider.addEventListener('input', () => setHem(key, Number(hems[key].slider.value)));
  }

  controller.onChange = () => {
    reframe();
    refreshHems();
    panel.refresh();
  };

  // ---- pointer: map canvas px inside the top rect to studio inches ----
  const toWorld = (e: PointerEvent): { x: number; z: number } | null => {
    if (!rects) return null;
    const b = canvas.getBoundingClientRect();
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const r = rects.top;
    if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return null;
    const span = studio.topView.spanIn;
    return {
      x: studio.topView.cx + ((px - r.x) / r.w - 0.5) * span,
      z: studio.topView.cz + ((py - r.y) / r.h - 0.5) * span,
    };
  };
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toWorld(e);
    if (!p) return;
    downAt = { x: e.clientX, y: e.clientY };
    if (!controller.hasGhost()) controller.pointerDown(p, controller.pickAt(p));
  });
  window.addEventListener('pointermove', onMove);
  function onMove(e: PointerEvent): void {
    controller.pointerMove(toWorld(e));
  }
  window.addEventListener('pointerup', onUp);
  function onUp(e: PointerEvent): void {
    controller.pointerUp();
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
      controller.click(toWorld(e));
    }
    downAt = null;
  }
  canvas.addEventListener('wheel', (e) => {
    if (!toWorld(e as unknown as PointerEvent)) return;
    e.preventDefault();
    controller.rotate(e.deltaY > 0 ? 15 : -15);
  }, { passive: false });
  window.addEventListener('keydown', onKey);
  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      if (controller.hasGhost()) controller.cancelGhost();
      else close();
    } else if (e.key === 'r' || e.key === 'R') {
      controller.rotate(e.key === 'R' ? -15 : 15);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      controller.deleteSelected();
    }
  }

  // ---- render loop (only while open) ----
  let raf = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    controller.step(dt);
    if (!rects) return;
    renderer.setScissorTest(true);
    const H = viewsWrap.clientHeight;
    const draw = (r: Rect, cam: THREE.Camera): void => {
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.render(studio.scene, cam);
    };
    draw(rects.top, studio.topCam);
    draw(rects.N, studio.sideCams.N);
    draw(rects.S, studio.sideCams.S);
    draw(rects.W, studio.sideCams.W);
    draw(rects.E, studio.sideCams.E);
  };

  const close = (): void => {
    delete (window as unknown as { __creator?: CreatorController }).__creator;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
    controller.dispose();
    studio.dispose();
    renderer.dispose();
    overlay.remove();
    openInstance = null;
  };

  const panel = buildCreatorPanel(modal, controller, {
    place() {
      if (!controller.state.tables.length) return;
      const design = controller.design();
      close();
      onPlace(design);
    },
    close,
  });

  const ro = new ResizeObserver(layout);
  ro.observe(viewsWrap);
  layout();
  refreshHems();
  controller.sync();
  raf = requestAnimationFrame(tick);
  openInstance = { close };
  // headless QA / debugging handle while the modal is open
  (window as unknown as { __creator?: CreatorController }).__creator = controller;
}

export function creatorIsOpen(): boolean {
  return openInstance !== null;
}
