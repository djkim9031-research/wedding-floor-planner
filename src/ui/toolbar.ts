import * as store from '../state/store';
import type { CameraRig } from '../scene/camera';
import type { SceneHost } from '../scene/scene';
import type { Settings } from '../types';
import { buildLayoutsMenu, buildPresetsMenu } from './layoutsMenu';
import { openCreator } from '../creator/creatorWindow';

export interface Toolbar {
  refresh(): void;
}

export function buildToolbar(
  root: HTMLElement,
  rig: CameraRig,
  host: SceneHost,
  toast: (msg: string) => void,
): Toolbar {
  const bar = document.createElement('div');
  bar.className = 'topbar';
  root.appendChild(bar);

  const title = document.createElement('div');
  title.className = 'app-title';
  title.innerHTML = 'Our Wedding Floor<small>Open Space · 45&prime;-5&Prime; × 49&prime;-11&Prime;</small>';
  bar.appendChild(title);

  const group = (parent: HTMLElement = bar): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'bar-group';
    parent.appendChild(g);
    return g;
  };

  const btn = (
    parent: HTMLElement,
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  const gHistory = group();
  const undoBtn = btn(gHistory, '↶', 'Undo (Ctrl+Z)', () => store.undo());
  const redoBtn = btn(gHistory, '↷', 'Redo (Ctrl+Shift+Z)', () => store.redo());

  const gMenus = group();
  gMenus.appendChild(buildPresetsMenu(toast));
  gMenus.appendChild(buildLayoutsMenu(toast));
  btn(gMenus, 'Table Sets', 'Design a table + linen set with live drape views', () => {
    openCreator((design) => {
      const label = store.placeSet(design);
      toast(`${label} placed — drag it into position`);
    });
  });

  const gToggles = group();
  const toggles: Array<[keyof Settings, HTMLButtonElement]> = [];
  const toggleBtn = (label: string, tip: string, key: keyof Settings): void => {
    const b = btn(gToggles, label, tip, () => {
      store.setSetting(key, !store.getState().settings[key]);
    });
    toggles.push([key, b]);
  };
  toggleBtn('Grid', 'Snap to 1-inch grid', 'gridSnap');
  toggleBtn('15°', 'Snap rotation to 15° (hold Shift for free)', 'angleSnap');
  toggleBtn('Magnet', 'Snap tables edge-to-edge', 'magnetSnap');
  toggleBtn('Dims', 'Show dimensions', 'showDims');
  const roofBtn = btn(gToggles, 'Ceiling', 'Show the roof & ceiling (C)', () => {
    host.setRoofVisible(!host.roofVisible());
    refresh();
  });

  const gViews = group();
  const topBtn = btn(gViews, 'Top', 'Plan view (T)', () => rig.toTopView());
  const orbitBtn = btn(gViews, 'Orbit', 'Default 3D view', () => {
    if (store.getState().viewMode === 'stand') {
      rig.exitStand();
      store.setViewMode('orbit');
    }
    rig.toDefaultView();
  });
  const standBtn = btn(gViews, 'Stand here', 'Eye-level view — tap the floor to move (V)', () => {
    if (store.getState().viewMode === 'stand') {
      rig.exitStand();
      store.setViewMode('orbit');
    } else {
      rig.enterStand();
      store.setViewMode('stand');
    }
  });
  void topBtn;
  void orbitBtn;

  const refresh = (): void => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    const s = store.getState();
    for (const [key, b] of toggles) b.classList.toggle('active', s.settings[key]);
    roofBtn.classList.toggle('active', host.roofVisible());
    standBtn.classList.toggle('active', s.viewMode === 'stand');
  };
  refresh();
  return { refresh };
}
