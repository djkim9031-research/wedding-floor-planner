import './ui/style.css';
import { ClothManager, predictDrape } from './cloth';
import { installKeyboard } from './interact/keyboard';
import { PlacementFSM } from './interact/placementFSM';
import { PointerController } from './interact/pointer';
import { RotateHandle } from './interact/rotateHandle';
import { CameraRig } from './scene/camera';
import { GhostVisual } from './scene/ghost';
import { ItemMeshes } from './scene/itemMeshes';
import { Overlays } from './scene/overlays';
import { createSceneHost } from './scene/scene';
import * as persist from './state/persist';
import * as store from './state/store';
import { buildPalette } from './ui/palette';
import { buildStatusPanel } from './ui/statusPanel';
import { buildToolbar } from './ui/toolbar';

const app = document.getElementById('app')!;
const container = document.createElement('div');
container.className = 'viewport';
app.appendChild(container);

const host = createSceneHost(container);
const rig = new CameraRig(host.canvas);

new ResizeObserver(() => {
  rig.setAspect(container.clientWidth / Math.max(container.clientHeight, 1));
  host.invalidate();
}).observe(container);

const itemMeshes = new ItemMeshes(host.itemsGroup);
const clothMgr = new ClothManager(host.itemsGroup);
const ghost = new GhostVisual(host.overlayGroup);
const overlays = new Overlays(host.overlayGroup);
const ring = new RotateHandle(host.overlayGroup);

const fsm = new PlacementFSM();
fsm.onGestureLock = (locked) => rig.setGestureLock(locked);
fsm.onHideItem = (id) => {
  itemMeshes.setHidden(id);
  host.invalidateShadows(); // hidden originals must not leave a baked shadow
};

const pointerCtl = new PointerController(
  container,
  host.canvas,
  rig,
  fsm,
  itemMeshes,
  host.itemsGroup,
  ring,
  () => host.invalidate(),
);

// ---- UI ----
const toastEl = document.createElement('div');
toastEl.className = 'toast';
container.appendChild(toastEl);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toast = (msg: string): void => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
};

const toolbar = buildToolbar(container, rig, host, toast);
buildPalette(container, fsm, pointerCtl);
const statusPanel = buildStatusPanel(container, fsm, {
  getReport: (id) => clothMgr.getReport(id),
  predict: predictDrape,
});

installKeyboard(fsm, rig, {
  toggleRoof: () => {
    host.setRoofVisible(!host.roofVisible());
    toolbar.refresh();
  },
});

// Roof follows stand mode for immersion; remember the user's own choice.
let roofBeforeStand = false;
rig.onModeChange = (mode) => {
  store.setViewMode(mode); // keep rig and store in lockstep however mode changed
  if (mode === 'stand') {
    fsm.cancel(); // a live gesture must not survive into stand mode
    roofBeforeStand = host.roofVisible();
    host.setRoofVisible(true);
  } else {
    host.setRoofVisible(roofBeforeStand);
  }
  toolbar.refresh();
};

// ---- store -> scene/UI sync ----
const updateRing = (): void => {
  const s = store.getState();
  const sel = s.items.find((it) => it.id === s.selectedId);
  if (sel && !s.ghost && s.viewMode === 'orbit') ring.show(sel);
  else ring.hide();
};

store.subscribe((s, ev) => {
  switch (ev.kind) {
    case 'items':
    case 'load':
      itemMeshes.sync(s.items);
      clothMgr.sync(s.items, ev.changedIds);
      overlays.update(s);
      persist.autosave(s.items);
      host.invalidateShadows();
      updateRing();
      fsm.refreshGhost(); // any live ghost re-derives snapping/validity
      break;
    case 'ghost':
      ghost.update(s.ghost, s.items);
      overlays.updateWallDistances(s);
      updateRing();
      break;
    case 'selection':
      itemMeshes.setSelected(s.selectedId, s.items);
      overlays.update(s);
      updateRing();
      break;
    case 'settings':
      overlays.update(s);
      break;
    case 'view':
      updateRing();
      break;
  }
  toolbar.refresh();
  statusPanel.refresh();
  host.invalidate();
});

clothMgr.onSettled(() => {
  statusPanel.refresh();
  host.invalidateShadows();
});

host.onFrame((dt) => clothMgr.step(dt));

// ---- boot ----
// hash params drive automated captures/QA: #preset=…&view=top|stand&cam=close&burn=1
const params = new URLSearchParams(location.hash.replace(/^#/, ''));
const presetName = params.get('preset');
if (presetName) {
  store.applyPreset(presetName);
} else {
  const saved = persist.loadAutosave();
  if (saved && saved.length) {
    store.importItems(saved);
    toast('Restored your last layout');
  }
}
if (params.get('demo') === 'qcc') {
  store.placeItem('tableQ', { x: 272.5, z: 300, yawDeg: 0 });
  store.placeItem('clothA', { x: 272.5, z: 300, yawDeg: 0 });
}
const view = params.get('view');
if (view === 'top') rig.toTopView();
else if (view === 'stand') {
  rig.enterStand({ x: 272.5, z: 500 });
  store.setViewMode('stand');
}
if (params.get('cam') === 'close') {
  rig.camera.position.set(4.4, 3.6, 12.4);
  rig.controls.target.set(6.92, 0.6, 7.62);
} else if (params.get('cam') === 'top') {
  rig.camera.position.set(6.92, 19, 7.64);
  rig.controls.target.set(6.92, 0, 7.62);
} else if (params.get('cam') === 'close2') {
  rig.camera.position.set(5.1, 2.3, 10.1);
  rig.controls.target.set(6.92, 0.9, 7.62);
}
if (params.get('roof') === '1') host.setRoofVisible(true);
if (params.get('burn') === '1') host.onFrame(() => true);

host.start(rig.camera, (dt) => rig.update(dt));
(window as unknown as { __wpBooted?: boolean }).__wpBooted = true;
