import * as store from '../state/store';
import type { CameraRig } from '../scene/camera';
import type { PlacementFSM } from './placementFSM';

export interface KeyboardActions {
  toggleRoof(): void;
}

export function installKeyboard(fsm: PlacementFSM, rig: CameraRig, actions: KeyboardActions): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (e.key === 'Shift') fsm.freeRotate = true;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      if (store.getState().selectedId) {
        e.preventDefault(); // only claim the browser's bookmark shortcut when it does something
        fsm.duplicateSelected();
      }
      return;
    }
    if (mod) return;

    // orbit view only — in stand mode arrows/WASD keep walking the camera
    const st = store.getState();
    const lower = e.key.toLowerCase();
    const nudges: Record<string, [number, number]> = {
      arrowup: [0, -1],
      w: [0, -1],
      arrowdown: [0, 1],
      s: [0, 1],
      arrowleft: [-1, 0],
      a: [-1, 0],
      arrowright: [1, 0],
      d: [1, 0],
    };
    if (nudges[lower] && st.selectedIds.length && st.viewMode !== 'stand') {
      e.preventDefault(); // claim the keys only when they move something
      const step = e.shiftKey ? 6 : 1;
      fsm.nudgeSelected(nudges[lower][0] * step, nudges[lower][1] * step);
      return;
    }

    switch (e.key) {
      case 'r':
      case 'R':
        fsm.rotateBy(15); // R clockwise, Q counter-clockwise (matches the creator)
        break;
      case 'q':
      case 'Q':
        fsm.rotateBy(-15);
        break;
      case 'e':
      case 'E':
        fsm.rotateBy(5); // fine adjust: E / [ ] step 5°
        break;
      case '[':
        fsm.rotateBy(-5);
        break;
      case ']':
        fsm.rotateBy(5);
        break;
      case 'Delete':
      case 'Backspace':
        fsm.deleteSelected();
        break;
      case 'Escape':
        if (store.getState().viewMode === 'stand') {
          rig.exitStand();
          store.setViewMode('orbit');
        } else {
          fsm.cancel();
        }
        break;
      case 't':
      case 'T':
        rig.toTopView();
        break;
      case 'v':
      case 'V':
        if (store.getState().viewMode === 'stand') {
          rig.exitStand();
          store.setViewMode('orbit');
        } else {
          rig.enterStand();
          store.setViewMode('stand');
        }
        break;
      case 'c':
      case 'C':
        actions.toggleRoof();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') fsm.freeRotate = false;
  });
}
