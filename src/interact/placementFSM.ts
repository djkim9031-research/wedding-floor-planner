import { SNAP, isTable } from '../constants';
import { normalizeDeg } from '../core/geometry';
import { angleSnap, edgeSnap, gridSnap } from '../core/snapping';
import { isPoseValid } from '../core/validity';
import * as store from '../state/store';
import type { GhostState, ItemType, Pose, Vec2 } from '../types';

export type FSMState = 'idle' | 'placing' | 'parked' | 'selected' | 'dragging' | 'rotating';

/**
 * The placement state machine. Transient ghost motion goes through
 * store.setGhost (not undoable); only commits mutate items.
 */
export class PlacementFSM {
  state: FSMState = 'idle';
  freeRotate = false; // Shift held: 1° rotation, no angle quantize on the ring

  /** camera enable/disable while a gesture owns the pointer */
  onGestureLock: (locked: boolean) => void = () => {};
  /** hide the original mesh while its ghost is dragged */
  onHideItem: (id: string | null) => void = () => {};
  onStateChange: (s: FSMState) => void = () => {};

  private ghostYaw = 0;
  private snappedActive = false;
  private lastFloor: Vec2 | null = null;
  private grabOffset: Vec2 = { x: 0, z: 0 };
  private dragSource: { id: string; pose: Pose; type: ItemType } | null = null;

  private setState(s: FSMState): void {
    if (this.state !== s) {
      this.state = s;
      this.onStateChange(s);
    }
  }

  private ghost(): GhostState | null {
    return store.getState().ghost;
  }

  private computeGhost(type: ItemType, x: number, z: number, sourceId?: string): GhostState {
    let pose: Pose = { x, z, yawDeg: this.ghostYaw };
    const { settings, items } = store.getState();
    if (settings.gridSnap) pose = gridSnap(pose);
    let snapped = null;
    if (settings.magnetSnap && isTable(type)) {
      snapped = edgeSnap(type, pose, items, sourceId, this.snappedActive ? SNAP.release : SNAP.engage);
      if (snapped) pose = snapped.pose;
    }
    this.snappedActive = !!snapped;
    const valid = isPoseValid(type, pose, items, sourceId);
    return { type, ...pose, valid, snapped: snapped ?? null, sourceId };
  }

  /** Re-derive snapping/validity for the live ghost — called after any items
   * mutation (undo, presets, imports) so the ghost never trusts stale state. */
  refreshGhost(): void {
    const g = this.ghost();
    if (!g) return;
    const next = this.computeGhost(g.type, g.x, g.z, g.sourceId);
    next.parked = g.parked;
    store.setGhost(next);
  }

  /** Palette click (desktop) or drag-out (touch). */
  startPlacing(type: ItemType, at?: Vec2): void {
    this.abortGhost();
    this.snappedActive = false;
    this.ghostYaw = 0;
    const p = at ?? this.lastFloor ?? { x: 272.5, z: 300 };
    this.grabOffset = { x: 0, z: 0 };
    store.select(null);
    store.setGhost(this.computeGhost(type, p.x, p.z));
    this.setState('placing');
  }

  /** Ghost follows the pointer. */
  pointerMove(floor: Vec2 | null): void {
    if (floor) this.lastFloor = floor;
    if (!floor) return;
    if (this.state === 'placing' || this.state === 'dragging') {
      const g = this.ghost();
      if (!g) return;
      const next = this.computeGhost(
        g.type,
        floor.x + this.grabOffset.x,
        floor.z + this.grabOffset.z,
        g.sourceId,
      );
      store.setGhost(next);
    } else if (this.state === 'parked') {
      const g = this.ghost();
      if (!g) return;
      const next = this.computeGhost(g.type, floor.x, floor.z, g.sourceId);
      next.parked = true;
      store.setGhost(next);
    }
  }

  /** Plain click / touch release while placing: try to commit. */
  commit(): void {
    const g = this.ghost();
    if (!g) return;
    // items may have changed since the ghost last moved (undo, presets, …):
    // never trust the cached flag at commit time
    const valid = isPoseValid(g.type, { x: g.x, z: g.z, yawDeg: g.yawDeg }, store.getState().items, g.sourceId);
    if (!valid) {
      if (this.state === 'placing') {
        // touch flow parks the ghost; desktop just refuses
        store.setGhost({ ...g, valid: false, parked: true });
        this.setState('parked');
      }
      return;
    }
    const pose: Pose = { x: g.x, z: g.z, yawDeg: g.yawDeg };
    if (g.sourceId) {
      this.onHideItem(null);
      store.moveItem(g.sourceId, pose);
      store.setGhost(null);
      store.select(g.sourceId);
      this.setState('selected');
    } else {
      const item = store.placeItem(g.type, pose);
      if (isTable(g.type) && this.state === 'placing' && !g.parked) {
        // Sims-style re-arm: keep placing more tables
        store.setGhost(this.computeGhost(g.type, g.x, g.z));
      } else {
        store.setGhost(null);
        store.select(item.id);
        this.setState('selected');
      }
    }
    this.onGestureLock(false);
  }

  /** Cancel ghost (Esc / right-click / ✕). */
  cancel(): void {
    if (this.state === 'placing' || this.state === 'parked' || this.state === 'dragging' || this.state === 'rotating') {
      this.abortGhost();
      const sel = store.getState().selectedId;
      this.setState(sel ? 'selected' : 'idle');
      this.onGestureLock(false);
    } else if (this.state === 'selected') {
      this.abortGhost(); // safety net for any orphaned ghost
      store.select(null);
      this.setState('idle');
    }
  }

  private abortGhost(): void {
    if (this.dragSource) {
      this.onHideItem(null);
      this.dragSource = null;
    }
    if (this.ghost()) store.setGhost(null);
  }

  /** Pointer went down on a placed item. */
  pointerDownItem(id: string, floor: Vec2 | null): void {
    // only from rest states — a second pointer mid-gesture must not corrupt
    // the active drag/rotate ghost
    if (this.state !== 'idle' && this.state !== 'selected') return;
    const item = store.getState().items.find((it) => it.id === id);
    if (!item) return;
    store.select(id);
    this.setState('selected');
    this.dragSource = { id, pose: { x: item.x, z: item.z, yawDeg: item.yawDeg }, type: item.type };
    if (floor) this.grabOffset = { x: item.x - floor.x, z: item.z - floor.z };
  }

  /** Called by the pointer controller once movement exceeds the threshold. */
  beginDrag(): void {
    if (!this.dragSource || this.state !== 'selected') return;
    const src = this.dragSource;
    this.ghostYaw = src.pose.yawDeg;
    this.snappedActive = false;
    this.onHideItem(src.id);
    store.setGhost(this.computeGhost(src.type, src.pose.x, src.pose.z, src.id));
    this.setState('dragging');
    this.onGestureLock(true);
  }

  /** Pointer released. */
  pointerUp(): void {
    if (this.state === 'dragging') {
      const g = this.ghost();
      if (g && g.valid) {
        this.commit();
      } else {
        // revert to pick-up pose
        this.onHideItem(null);
        store.setGhost(null);
        this.setState('selected');
      }
      this.dragSource = null;
      this.onGestureLock(false);
    } else if (this.state === 'rotating') {
      const g = this.ghost();
      if (g && g.sourceId && g.valid) {
        this.onHideItem(null);
        store.moveItem(g.sourceId, { x: g.x, z: g.z, yawDeg: g.yawDeg });
        store.setGhost(null);
      } else {
        this.onHideItem(null);
        store.setGhost(null);
      }
      this.setState('selected');
      this.dragSource = null;
      this.onGestureLock(false);
    } else {
      this.dragSource = null;
    }
  }

  /** Click on empty floor (no drag). */
  clickFloor(): void {
    if (this.state === 'placing') {
      this.commit();
    } else if (this.state === 'parked') {
      // taps on the floor move the parked ghost via pointerMove; nothing here
    } else if (this.state === 'selected') {
      store.select(null);
      this.setState('idle');
    }
  }

  /** Rotate the ghost (while placing/dragging) or the selected item. */
  rotateBy(deg: number): void {
    const g = this.ghost();
    if (g) {
      this.ghostYaw = normalizeDeg(this.ghostYaw + deg);
      const next = this.computeGhost(g.type, g.x, g.z, g.sourceId);
      next.parked = g.parked;
      store.setGhost(next);
      return;
    }
    const { selectedId, items } = store.getState();
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;
    const yawDeg = normalizeDeg(item.yawDeg + deg);
    const pose = { x: item.x, z: item.z, yawDeg };
    if (isPoseValid(item.type, pose, items, item.id)) {
      store.moveItem(item.id, pose);
    }
  }

  /** Ring-handle rotation: absolute yaw while 'rotating'. */
  startRotating(): void {
    const { selectedId, items } = store.getState();
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;
    this.dragSource = { id: item.id, pose: { x: item.x, z: item.z, yawDeg: item.yawDeg }, type: item.type };
    this.ghostYaw = item.yawDeg;
    this.onHideItem(item.id);
    store.setGhost(this.computeGhost(item.type, item.x, item.z, item.id));
    this.setState('rotating');
    this.onGestureLock(true);
  }

  setRotationYaw(yawDeg: number): void {
    if (this.state !== 'rotating') return;
    const g = this.ghost();
    if (!g) return;
    const { settings } = store.getState();
    let yaw = normalizeDeg(yawDeg);
    if (settings.angleSnap && !this.freeRotate) {
      yaw = normalizeDeg(Math.round(yaw / SNAP.angleDeg) * SNAP.angleDeg);
    }
    this.ghostYaw = yaw;
    const next = this.computeGhost(g.type, g.x, g.z, g.sourceId);
    store.setGhost(next);
  }

  deleteSelected(): void {
    const id = store.getState().selectedId;
    if (!id) return;
    this.abortGhost();
    store.deleteItem(id);
    this.setState('idle');
  }

  duplicateSelected(): void {
    const { selectedId, items } = store.getState();
    const item = items.find((it) => it.id === selectedId);
    if (!item) return;
    this.abortGhost();
    this.ghostYaw = item.yawDeg;
    this.snappedActive = false;
    this.grabOffset = { x: 0, z: 0 };
    store.setGhost(this.computeGhost(item.type, item.x + 12, item.z + 12));
    this.setState('placing');
  }

  /** ✓ button on a parked ghost. */
  confirmParked(): void {
    if (this.state !== 'parked') return;
    const g = this.ghost();
    if (!g) return;
    g.parked = false;
    this.setState('placing');
    this.commit(); // commit re-validates and re-parks on failure
  }
}
