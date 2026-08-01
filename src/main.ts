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
import { horizonAltDeg, moonState, sunPosition } from './scene/sun';
import { buildItemsPanel } from './ui/itemsPanel';
import { buildPalette } from './ui/palette';
import { buildStatusPanel } from './ui/statusPanel';
import { buildSunPanel } from './ui/sunPanel';
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
  clothMgr.setHidden(id); // a grabbed cloth shows only its flat ghost
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
const sunPanel = buildSunPanel(container, (s) => {
  if (!s.enabled) {
    host.applySun(null);
    return;
  }
  const pos = sunPosition(s.date, s.minutes);
  const moon = moonState(s.date, s.minutes);
  host.applySun({
    // ridge-effective altitude: the western mountains swallow the sun early
    altitudeDeg: pos.altitudeDeg - horizonAltDeg(pos.azimuthDeg),
    azimuthModelDeg: pos.azimuthModelDeg,
    clouds: s.clouds ? s.cloudPct / 100 : 0,
    moon: {
      altitudeDeg: moon.altitudeDeg,
      azimuthModelDeg: moon.azimuthModelDeg,
      fraction: moon.fraction,
      brightLimbDeg: moon.brightLimbDeg,
    },
  });
});
const statusPanel = buildStatusPanel(container, fsm, {
  getReport: (id) => clothMgr.getReport(id),
  predict: predictDrape,
});
const itemsPanel = buildItemsPanel(container, fsm);
fsm.onLockChange = (id) => {
  itemsPanel.refresh();
  if (id) toast('Locked 🔒 — drag anywhere or use the arrow keys; Esc unlocks');
};

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
      // a lock must not outlive its item (delete-all, undo, imports…)
      if (fsm.lockedId && !s.items.some((it) => it.id === fsm.lockedId)) fsm.unlock();
      clothMgr.sync(s.items, ev.changedIds);
      itemMeshes.sync(s.items, (it) => clothMgr.mountLift(it, s.items));
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
      itemMeshes.setSelected(s.selectedIds, s.items);
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
  if (ev.kind === 'items' || ev.kind === 'load' || ev.kind === 'selection') {
    itemsPanel.refresh();
  }
  toolbar.refresh();
  statusPanel.refresh();
  host.invalidate();
});

clothMgr.onSettled(() => {
  statusPanel.refresh();
  // decor placed after a cloth rides its surface — re-mount on settle
  const s = store.getState();
  itemMeshes.sync(s.items, (it) => clothMgr.mountLift(it, s.items));
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
} else if (params.get('demo') === 'deck') {
  store.placeItem('table', { x: 200, z: -160, yawDeg: 40 });
  store.placeItem('clothA', { x: 200, z: -160, yawDeg: 40 });
  store.placeItem('tableSq', { x: 420, z: -220, yawDeg: 10 });
  store.placeItem('lantern30', { x: 330, z: -110, yawDeg: 0 });
  store.placeItem('lantern24', { x: 140, z: -260, yawDeg: 0 });
  store.placeItem('chair', { x: 455, z: -185, yawDeg: 190 });
  store.placeItem('figureM', { x: 380, z: -280, yawDeg: 140 });
} else if (params.get('demo') === 'dinner') {
  // the planned rental setup: 3-table block, cloth, bistro chairs, settings,
  // lanterns, and a privacy hedge + screen
  store.applyPreset('Crate & Barrel');
  for (const z of [268.5, 300, 331.5]) {
    store.placeItem('chair', { x: 240, z, yawDeg: 270 });
    store.placeItem('chair', { x: 305, z, yawDeg: 90 });
    store.placeItem('setting', { x: 254, z, yawDeg: 270 });
    store.placeItem('setting', { x: 291, z, yawDeg: 90 });
  }
  store.placeItem('lantern18', { x: 272.5, z: 284, yawDeg: 0 });
  store.placeItem('lantern18', { x: 272.5, z: 316, yawDeg: 0 });
  store.placeItem('hedge', { x: 460, z: 160, yawDeg: 315 });
  store.placeItem('screen', { x: 120, z: 420, yawDeg: 30 });
  store.placeItem('figureW', { x: 350, z: 250, yawDeg: 220 });
} else if (params.get('demo') === 'lanterns') {
  store.placeItem('table', { x: 272.5, z: 300, yawDeg: 0 });
  store.placeItem('clothB', { x: 272.5, z: 300, yawDeg: 0 });
  store.placeItem('lantern18', { x: 258, z: 300, yawDeg: 0 });
  store.placeItem('lantern18', { x: 287, z: 300, yawDeg: 0 });
  store.placeItem('lantern30', { x: 210, z: 260, yawDeg: 0 });
  store.placeItem('lantern36', { x: 340, z: 345, yawDeg: 0 });
  store.placeItem('lantern24', { x: 240, z: 360, yawDeg: 0 });
} else if (params.get('demo') === 'over') {
  // QA: linens draping over non-table obstacles
  store.placeItem('chair', { x: 243, z: 300, yawDeg: 0 });
  store.placeItem('chair', { x: 265, z: 300, yawDeg: 0 });
  store.placeItem('tableSq', { x: 320, z: 300, yawDeg: 0 });
  store.placeItem('clothA', { x: 285, z: 300, yawDeg: 0 });
  store.placeItem('hedge', { x: 430, z: 180, yawDeg: 0 });
  store.placeItem('clothB', { x: 430, z: 180, yawDeg: 0 });
} else if (params.get('demo') === 'chairs') {
  store.placeItem('table', { x: 272.5, z: 300, yawDeg: 0 });
  store.placeItem('chair', { x: 262, z: 278.25, yawDeg: 0 });
  store.placeItem('chair', { x: 283, z: 278.25, yawDeg: 0 });
  store.placeItem('chair', { x: 262, z: 321.75, yawDeg: 180 });
  store.placeItem('figureW', { x: 330, z: 292, yawDeg: 240 });
  store.placeItem('figureM', { x: 344, z: 306, yawDeg: 300 });
}
const view = params.get('view');
if (view === 'top') rig.toTopView();
else if (view === 'stand') {
  rig.enterStand({ x: 272.5, z: 500 });
  store.setViewMode('stand');
}
if (params.get('qa') === 'group') {
  // capture aid: group-select every table after the preset settles
  setTimeout(() => {
    const ids = store
      .getState()
      .items.filter((it) => it.type === 'table')
      .map((it) => it.id);
    fsm.selectMarquee(ids);
  }, 4000);
}
if (params.get('qa') === 'probe') {
  // headless QA: live cloth-height overlay over every mounted obstacle
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;top:60px;left:8px;z-index:99;background:#000c;color:#0f0;font:12px monospace;padding:8px;max-width:420px;white-space:pre-wrap;';
  document.body.appendChild(div);
  setInterval(() => {
    const s = store.getState();
    const out: string[] = [];
    for (const it of s.items) {
      if (it.type === 'clothA' || it.type === 'clothB') continue;
      const m = clothMgr.debugMaxOver(it.x, it.z, 5);
      out.push(`${it.type}@${it.x},${it.z}=${m.toFixed(1)}`);
    }
    out.unshift(clothMgr.debugStates());
    document.title = 'PROBE ' + out.join(' ');
    div.textContent = out.join('\n');
  }, 1000);
}
if (params.get('qa') === 'move') {
  // capture aid: prove cloth re-drapes when a table under it is moved
  setTimeout(() => {
    const t = store.getState().items.filter((it) => it.type === 'table')[1];
    if (t) store.moveItem(t.id, { x: t.x + 70, z: t.z, yawDeg: t.yawDeg });
  }, 5000);
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
} else if (params.get('cam') === 'site') {
  rig.camera.position.set(7.1, 27, 24);
  rig.controls.target.set(7.1, 0, 2.5);
} else if (params.get('cam') === 'site2') {
  rig.camera.position.set(7.1, 44, 50);
  rig.controls.target.set(7.1, 0, 18);
} else if (params.get('cam') === 'entry') {
  rig.camera.position.set(6.92, 2.4, 48.8);
  rig.controls.target.set(6.92, 2.0, 33);
} else if (params.get('cam') === 'deckfloor') {
  rig.camera.position.set(5.5, 2.2, -3.2);
  rig.controls.target.set(7.5, 0, -5.2);
} else if (params.get('cam') === 'hall') {
  rig.camera.position.set(7.6, 1.6, 12.6);
  rig.controls.target.set(3.3, 1.1, 16.3);
}
if (params.get('roof') === '1') host.setRoofVisible(true);
if (params.get('burn') === '1') host.onFrame(() => true);
// deterministic captures: #sun=YYYY-MM-DD,HH:MM,cloudPct  or  #sun=off
const sunParam = params.get('sun');
if (sunParam === 'off') {
  sunPanel.set({ enabled: false });
} else if (sunParam) {
  const [d, t, c] = sunParam.split(',');
  const [hh, mm] = (t ?? '12:00').split(':').map(Number);
  sunPanel.set({
    enabled: true,
    date: d,
    minutes: hh * 60 + (mm || 0),
    clouds: !!c && +c > 0,
    cloudPct: c ? +c : 0,
  });
}

host.start(rig.camera, (dt) => rig.update(dt));
(window as unknown as { __wpBooted?: boolean }).__wpBooted = true;
