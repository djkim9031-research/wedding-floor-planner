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

    switch (e.key) {
      case 'r':
        fsm.rotateBy(15);
        break;
      case 'R':
        fsm.rotateBy(-15);
        break;
      case 'q':
      case 'Q':
        fsm.rotateBy(-5);
        break;
      case 'e':
      case 'E':
        fsm.rotateBy(5);
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
