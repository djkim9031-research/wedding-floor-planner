import { SNAP, isTable } from '../constants';
import { DEG as DEG_TO_RAD, normalizeDeg } from '../core/geometry';
import { angleSnap, edgeSnap, gridSnap } from '../core/snapping';
import { isPoseValid } from '../core/validity';
import * as store from '../state/store';
import type { GhostState, ItemType, Pose, Vec2 } from '../types';

export type FSMState = 'idle' | 'placing' | 'parked' | 'selected' | 'dragging' | 'rotating' | 'groupDragging';

/**
 * The placement state machine. Transient ghost motion goes through
 * store.setGhost (not undoable); only commits mutate items.
 */
export class PlacementFSM {
  state: FSMState = 'idle';
  freeRotate = false; // Shift held: 1° rotation, no angle quantize on the ring
  /** list-locked item: every mouse drag / keyboard nudge targets it until Esc */
  lockedId: string | null = null;

  /** camera enable/disable while a gesture owns the pointer */
  onGestureLock: (locked: boolean) => void = () => {};
  /** hide the original mesh while its ghost is dragged */
  onHideItem: (id: string | null) => void = () => {};
  onStateChange: (s: FSMState) => void = () => {};
  onLockChange: (id: string | null) => void = () => {};

  private ghostYaw = 0;
  private snappedActive = false;
  private lastFloor: Vec2 | null = null;
  private grabOffset: Vec2 = { x: 0, z: 0 };
  private dragSource: { id: string; pose: Pose; type: ItemType } | null = null;
  /** live group drag: original poses + grab point + accumulated group yaw */
  private groupDrag: {
    startFloor: Vec2;
    originals: { id: string; type: ItemType; pose: Pose }[];
    yawAcc: number;
    applied: boolean;
  } | null = null;

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
    if (this.state === 'groupDragging' && this.groupDrag) {
      this.applyGroupTransform(floor);
      return;
    }
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
      store.placeItem(g.type, pose);
      if ((isTable(g.type) || g.type === 'chair') && this.state === 'placing' && !g.parked) {
        // Sims-style re-arm: keep placing more of the same
        store.setGhost(this.computeGhost(g.type, g.x, g.z));
      } else {
        // selection happens only by clicking the item or its list row
        store.setGhost(null);
        this.setState('idle');
      }
    }
    this.onGestureLock(false);
  }

  /** Lock an item from the placed list: it stays the sole move target. */
  lock(id: string): void {
    if (this.state !== 'idle' && this.state !== 'selected') this.cancel();
    store.select(id);
    this.setState('selected');
    if (this.lockedId !== id) {
      this.lockedId = id;
      this.onLockChange(id);
    }
  }

  unlock(): void {
    if (this.lockedId !== null) {
      this.lockedId = null;
      this.onLockChange(null);
    }
  }

  /** Cancel ghost (Esc / right-click / ✕). */
  cancel(): void {
    if (this.state === 'groupDragging') {
      const g = this.groupDrag;
      this.groupDrag = null;
      if (g && g.applied) {
        store.moveItemsLive(g.originals.map((o) => ({ id: o.id, pose: o.pose })));
      }
      this.setState('selected');
      this.onGestureLock(false);
      return;
    }
    if (this.state === 'placing' || this.state === 'parked' || this.state === 'dragging' || this.state === 'rotating') {
      this.abortGhost();
      const sel = store.getState().selectedId;
      this.setState(sel ? 'selected' : 'idle');
      this.onGestureLock(false);
    } else if (this.state === 'selected') {
      if (this.lockedId) {
        // first Esc releases the lock, the item stays selected
        this.unlock();
        return;
      }
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
    const s = store.getState();
    const item = s.items.find((it) => it.id === id);
    if (!item) return;
    if (s.selectedIds.length > 1 && s.selectedIds.includes(id) && floor) {
      // grabbing a member of the group: the whole group rides along
      this.groupDrag = {
        startFloor: floor,
        originals: s.items
          .filter((it) => s.selectedIds.includes(it.id))
          .map((it) => ({ id: it.id, type: it.type, pose: { x: it.x, z: it.z, yawDeg: it.yawDeg } })),
        yawAcc: 0,
        applied: false,
      };
      this.setState('selected');
      return;
    }
    this.groupDrag = null;
    store.select(id);
    this.setState('selected');
    this.dragSource = { id, pose: { x: item.x, z: item.z, yawDeg: item.yawDeg }, type: item.type };
    if (floor) this.grabOffset = { x: item.x - floor.x, z: item.z - floor.z };
  }

  /** Called by the pointer controller once movement exceeds the threshold. */
  beginDrag(): void {
    if (this.groupDrag && this.state === 'selected') {
      this.setState('groupDragging');
      this.onGestureLock(true);
      return;
    }
    if (!this.dragSource || this.state !== 'selected') return;
    const src = this.dragSource;
    this.ghostYaw = src.pose.yawDeg;
    this.snappedActive = false;
    this.onHideItem(src.id);
    store.setGhost(this.computeGhost(src.type, src.pose.x, src.pose.z, src.id));
    this.setState('dragging');
    this.onGestureLock(true);
  }

  /** Translate+rotate the whole group about its centroid; apply only when
   * every member lands valid (validated against non-members). */
  private applyGroupTransform(floor: Vec2): void {
    const g = this.groupDrag;
    if (!g) return;
    const dx = floor.x - g.startFloor.x;
    const dz = floor.z - g.startFloor.z;
    const cx = g.originals.reduce((a, o) => a + o.pose.x, 0) / g.originals.length;
    const cz = g.originals.reduce((a, o) => a + o.pose.z, 0) / g.originals.length;
    const rad = g.yawAcc * DEG_TO_RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ids = g.originals.map((o) => o.id);
    const { items } = store.getState();
    const updates = g.originals.map((o) => {
      const rx = o.pose.x - cx;
      const rz = o.pose.z - cz;
      // yaw about +Y maps +X toward −Z (matches three.js rotation.y)
      const wx = cx + rx * cos + rz * sin + dx;
      const wz = cz - rx * sin + rz * cos + dz;
      return { id: o.id, pose: { x: wx, z: wz, yawDeg: normalizeDeg(o.pose.yawDeg + g.yawAcc) } };
    });
    const allValid = updates.every((u, i) =>
      isPoseValid(g.originals[i].type, u.pose, items, ids),
    );
    if (allValid) {
      store.moveItemsLive(updates);
      g.applied = true;
    }
  }

  /** Rotate the live group (wheel / R while group-dragging). */
  rotateGroupBy(deg: number): void {
    if (this.state === 'groupDragging' && this.groupDrag) {
      this.groupDrag.yawAcc = normalizeDeg(this.groupDrag.yawAcc + deg);
      if (this.lastFloor) this.applyGroupTransform(this.lastFloor);
      return;
    }
    // stationary group rotate: one undo step per press
    const s = store.getState();
    if (s.selectedIds.length < 2) return;
    const members = s.items.filter((it) => s.selectedIds.includes(it.id));
    const cx = members.reduce((a, o) => a + o.x, 0) / members.length;
    const cz = members.reduce((a, o) => a + o.z, 0) / members.length;
    const rad = deg * DEG_TO_RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const updates = members.map((o) => {
      const rx = o.x - cx;
      const rz = o.z - cz;
      return {
        id: o.id,
        pose: { x: cx + rx * cos + rz * sin, z: cz - rx * sin + rz * cos, yawDeg: normalizeDeg(o.yawDeg + deg) },
      };
    });
    const ids = members.map((o) => o.id);
    const ok = updates.every((u, i) => isPoseValid(members[i].type, u.pose, s.items, ids));
    if (ok) store.moveItems(updates);
  }

  /** Marquee result: select the ids as a group. */
  selectMarquee(ids: string[]): void {
    if (this.state !== 'idle' && this.state !== 'selected') return;
    this.unlock();
    store.selectGroup(ids);
    this.setState(ids.length ? 'selected' : 'idle');
  }

  /** Pointer released. */
  pointerUp(): void {
    if (this.state === 'groupDragging') {
      const g = this.groupDrag;
      this.groupDrag = null;
      if (g && g.applied) {
        store.commitGroupMove(g.originals.map((o) => ({ id: o.id, pose: o.pose })));
      }
      this.setState('selected');
      this.onGestureLock(false);
      return;
    }
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
      if (this.lockedId) return; // locked selection survives stray clicks
      this.groupDrag = null;
      store.select(null);
      this.setState('idle');
    }
  }

  /** Arrow-key nudge of the selected item or group (inches, world axes). */
  nudgeSelected(dx: number, dz: number): void {
    if (this.ghost()) return; // a live ghost owns the pointer/keys
    const s = store.getState();
    if (s.selectedIds.length > 1) {
      const members = s.items.filter((it) => s.selectedIds.includes(it.id));
      const ids = members.map((o) => o.id);
      const updates = members.map((o) => ({
        id: o.id,
        pose: { x: o.x + dx, z: o.z + dz, yawDeg: o.yawDeg },
      }));
      const ok = updates.every((u, i) => isPoseValid(members[i].type, u.pose, s.items, ids));
      if (ok) store.moveItems(updates);
      return;
    }
    const item = s.items.find((it) => it.id === s.selectedId);
    if (!item) return;
    const pose = { x: item.x + dx, z: item.z + dz, yawDeg: item.yawDeg };
    if (isPoseValid(item.type, pose, s.items, item.id)) {
      store.moveItem(item.id, pose);
    }
  }

  /** Rotate the ghost (while placing/dragging) or the selected item/group. */
  rotateBy(deg: number): void {
    if (this.state === 'groupDragging' || store.getState().selectedIds.length > 1) {
      this.rotateGroupBy(deg);
      return;
    }
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
    const s = store.getState();
    if (s.selectedIds.length > 1) {
      this.abortGhost();
      this.groupDrag = null;
      this.unlock();
      store.deleteItems(s.selectedIds);
      this.setState('idle');
      return;
    }
    const id = s.selectedId;
    if (!id) return;
    this.abortGhost();
    if (this.lockedId === id) this.unlock();
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
