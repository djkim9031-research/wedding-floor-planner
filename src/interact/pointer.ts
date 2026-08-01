import * as THREE from 'three';
import { ITEM_DIMS, i2m } from '../constants';
import * as store from '../state/store';
import type { Vec2 } from '../types';
import type { CameraRig } from '../scene/camera';
import type { ItemMeshes } from '../scene/itemMeshes';
import type { PlacementFSM } from './placementFSM';
import type { RotateHandle } from './rotateHandle';

const DRAG_THRESHOLD_PX = 5;
const CLICK_THRESHOLD_PX = 6;

/**
 * Unifies mouse/touch pointer events, raycasts, and camera arbitration.
 * Registered in the CAPTURE phase on the container so gestures that belong to
 * items can be claimed before OrbitControls (listening on the canvas) sees
 * them. One gesture at a time: the `down` record is keyed by pointerId and a
 * second concurrent pointer is ignored.
 */
export class PointerController {
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private suppressContextMenu = false;
  private down: {
    pointerId: number;
    x: number;
    y: number;
    itemId: string | null;
    onRing: boolean;
    claimed: boolean;
  } | null = null;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private fsm: PlacementFSM,
    private itemMeshes: ItemMeshes,
    private itemsGroup: THREE.Group,
    private ring: RotateHandle,
    private invalidate: () => void,
  ) {
    container.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    container.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    container.addEventListener('contextmenu', this.onContextMenu);
  }

  clientToFloor(cx: number, cy: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return null;
    return { x: hit.x / i2m(1), z: hit.z / i2m(1) };
  }

  private hitItem(cx: number, cy: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.itemsGroup.children, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData.itemId) return obj.userData.itemId as string;
        obj = obj.parent;
      }
    }
    return null;
  }

  /** Is the floor point on/near the active parked ghost? */
  private onParkedGhost(floor: Vec2 | null): boolean {
    const g = store.getState().ghost;
    if (!g || !floor) return false;
    const dims = ITEM_DIMS[g.type];
    const r = Math.hypot(dims.w, dims.d) / 2 + 10;
    return Math.hypot(floor.x - g.x, floor.z - g.z) < r;
  }

  private onDown = (e: PointerEvent) => {
    if (store.getState().viewMode === 'stand') return;
    if (e.target !== this.canvas) return; // UI overlay owns its own events
    if (this.down) return; // one gesture at a time
    const floor = this.clientToFloor(e.clientX, e.clientY);
    const onRing = this.ring.hitTest(this.raycaster, this.rig.camera, e, this.canvas);
    const itemId = onRing ? null : this.hitItem(e.clientX, e.clientY);
    const state = this.fsm.state;

    this.down = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      itemId,
      onRing,
      claimed: false,
    };

    if (onRing) {
      this.down.claimed = true;
      this.fsm.startRotating();
      if (floor) this.ring.dragTo(floor, this.fsm);
      e.stopPropagation();
      return;
    }

    // list-locked selection: every canvas drag moves the locked item — no
    // camera orbit, no accidental grabs of other items — until Esc
    if (this.fsm.lockedId && (state === 'idle' || state === 'selected')) {
      this.down.itemId = this.fsm.lockedId;
      this.down.claimed = true;
      this.fsm.pointerDownItem(this.fsm.lockedId, floor);
      this.rig.setGestureLock(true);
      e.stopPropagation();
      return;
    }

    if (state === 'parked') {
      // drags near the ghost reposition it; elsewhere the camera stays live
      if (this.onParkedGhost(floor)) {
        this.down.claimed = true;
        this.rig.setGestureLock(true);
        e.stopPropagation();
      } else {
        this.down = null;
      }
      return;
    }

    if (state === 'placing') {
      // leave the camera live: drag orbits, plain click commits (handled on up)
      if (e.button === 2) {
        this.fsm.cancel();
        this.suppressContextMenu = true;
        this.down = null;
        e.stopPropagation();
      }
      return;
    }

    if (itemId) {
      this.down.claimed = true;
      this.fsm.pointerDownItem(itemId, floor);
      this.rig.setGestureLock(true);
      e.stopPropagation();
    }
  };

  private onMove = (e: PointerEvent) => {
    if (store.getState().viewMode === 'stand') return;
    if (this.down && e.pointerId !== this.down.pointerId) return;
    const state = this.fsm.state;
    const floor = this.clientToFloor(e.clientX, e.clientY);

    if (this.down) {
      const dist = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      if (this.down.onRing) {
        if (floor && state === 'rotating') this.ring.dragTo(floor, this.fsm);
        return;
      }
      if (this.down.claimed && state === 'parked') {
        if (dist > DRAG_THRESHOLD_PX) this.fsm.pointerMove(floor);
        return;
      }
      if (this.down.itemId && state === 'selected' && dist > DRAG_THRESHOLD_PX) {
        this.fsm.beginDrag();
      }
      if (state === 'dragging') {
        this.fsm.pointerMove(floor);
        return;
      }
    }

    if (state === 'placing') {
      this.fsm.pointerMove(floor);
      return;
    }

    // hover highlight when nothing pressed
    if (!this.down && (state === 'idle' || state === 'selected')) {
      const id = e.target === this.canvas ? this.hitItem(e.clientX, e.clientY) : null;
      if (this.itemMeshes.setHovered(id, store.getState().items)) this.invalidate();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.down && e.pointerId !== this.down.pointerId) return;
    if (store.getState().viewMode === 'stand') {
      this.down = null;
      this.rig.setGestureLock(false);
      return;
    }
    const down = this.down;
    this.down = null;
    const state = this.fsm.state;

    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);

    if (down.onRing || state === 'rotating' || state === 'dragging') {
      this.fsm.pointerUp();
      this.rig.setGestureLock(false);
      return;
    }

    if (state === 'parked') {
      this.rig.setGestureLock(false);
      return;
    }

    if (state === 'placing') {
      if (e.button === 2) return;
      if (dist < CLICK_THRESHOLD_PX) {
        // touch taps arrive without hover: sync the ghost to the tap point first
        this.fsm.pointerMove(this.clientToFloor(e.clientX, e.clientY));
        this.fsm.commit();
      }
      return;
    }

    if (down.claimed) {
      // pressed an item but never crossed the drag threshold: it's a click
      this.fsm.pointerUp();
      this.rig.setGestureLock(false);
      return;
    }

    // released on empty space
    if (dist < CLICK_THRESHOLD_PX && e.target === this.canvas) {
      this.fsm.clickFloor();
    }
  };

  private onCancel = (e: PointerEvent) => {
    if (this.down && e.pointerId !== this.down.pointerId) return;
    const down = this.down;
    this.down = null;
    this.rig.setGestureLock(false);
    if (!down) return;
    // a cancelled gesture must never commit: revert drags/rotations outright
    if (this.fsm.state === 'dragging' || this.fsm.state === 'rotating') {
      this.fsm.cancel();
    }
  };

  private onWheel = (e: WheelEvent) => {
    const state = this.fsm.state;
    if (state === 'placing' || state === 'dragging' || state === 'parked') {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 1 : 15;
      this.fsm.rotateBy(e.deltaY > 0 ? step : -step);
    }
  };

  private onContextMenu = (e: Event) => {
    const state = this.fsm.state;
    if (this.suppressContextMenu || state === 'placing' || state === 'dragging' || state === 'parked') {
      this.suppressContextMenu = false;
      e.preventDefault();
    }
  };
}
