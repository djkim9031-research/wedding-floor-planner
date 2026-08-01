import * as THREE from 'three';
import { IN, ITEM_DIMS, isTable } from '../constants';
import { aabbToOBB, obbFromPose, obbIntersectsOBB, type OBB } from '../core/geometry';
import type { DrapeReport, PlacedItem, Pose } from '../types';
import { DT, INVALIDATE_MARGIN, MAX_CATCHUP_FRAMES, makeClothSpec } from './constants';
import { buildColliders } from './colliders';
import { disposeClothResources } from './clothMesh';
import { ClothSim } from './ClothSim';
import { predictDrape } from './measure';

interface Instance {
  sim: ClothSim;
  notified: boolean;
  dirty: boolean;
}

type SettledCb = (id: string, report: DrapeReport) => void;

/** Owns every cloth instance: reconciles with the item store, rebuilds the
 * collision world from tables, fans table changes out to overlapping cloths,
 * and drives the fixed-step loop. Cloth geometry is in inches; this group
 * carries the single inches→meters scale. */
export class ClothManager {
  private readonly parent: THREE.Group;
  private readonly group: THREE.Group;
  private readonly instances = new Map<string, Instance>();
  private readonly prevObstacles = new Map<string, PlacedItem>();
  private readonly cbs: SettledCb[] = [];
  private lastTables: PlacedItem[] = [];
  private lastOrder = new Map<string, number>();
  private acc = 0;
  /** QA counters */
  stepCalls = 0;
  framesRun = 0;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.scale.setScalar(IN);
    parent.add(this.group);
  }

  /** Reconcile cloth instances with the placed items. `changedIds` narrows the
   * invalidation fan-out to the obstacles that actually moved/appeared/vanished;
   * omitted, changes are inferred from the previously seen obstacle poses. */
  sync(items: PlacedItem[], changedIds?: string[]): void {
    // every non-cloth item is a drape obstacle now, not just tables — but
    // stacking follows placement order: a cloth drapes only over items placed
    // BEFORE it; items placed after ride on top of the settled fabric
    const obstacles = items.filter((it) => it.type !== 'clothA' && it.type !== 'clothB');
    const orderIdx = new Map(items.map((it, i) => [it.id, i]));
    this.lastOrder = orderIdx;
    this.lastTables = obstacles.filter((it) => isTable(it.type));

    let changed: string[];
    if (changedIds) {
      changed = changedIds.filter(
        (id) => this.prevObstacles.has(id) || obstacles.some((t) => t.id === id)
      );
    } else {
      changed = [];
      for (const t of obstacles) {
        const p = this.prevObstacles.get(t.id);
        if (!p || p.x !== t.x || p.z !== t.z || p.yawDeg !== t.yawDeg) changed.push(t.id);
      }
      for (const id of this.prevObstacles.keys()) {
        if (!obstacles.some((t) => t.id === id)) changed.push(id);
      }
    }

    // old + new footprints of every changed obstacle (+ its placement order,
    // so post-cloth items never trigger a re-drape of that cloth)
    const changedObbs: OBB[] = [];
    const underChangeIdx: number[] = [];
    for (const id of changed) {
      const idx = orderIdx.get(id) ?? Infinity;
      const old = this.prevObstacles.get(id);
      if (old) {
        changedObbs.push(obbFromPose(old, ITEM_DIMS[old.type]));
        underChangeIdx.push(idx);
      }
      const cur = obstacles.find((t) => t.id === id);
      if (cur) {
        changedObbs.push(obbFromPose(cur, ITEM_DIMS[cur.type]));
        underChangeIdx.push(idx);
      }
    }

    // drop instances whose item is gone (or changed type)
    for (const [id, inst] of this.instances) {
      const still = items.some((it) => it.id === id && it.type === inst.sim.spec.type);
      if (!still) {
        this.group.remove(inst.sim.mesh);
        inst.sim.dispose();
        this.instances.delete(id);
      }
    }

    for (const it of items) {
      if (it.type !== 'clothA' && it.type !== 'clothB') continue;
      const pose: Pose = { x: it.x, z: it.z, yawDeg: it.yawDeg };
      const clothIdx = orderIdx.get(it.id)!;
      // only obstacles placed before this cloth are under its drape
      const under = obstacles.filter((o) => (orderIdx.get(o.id) ?? Infinity) < clothIdx);
      // per-cloth collision world, culled to obstacles this cloth can reach
      // (keeps the hot loop small in furnished rooms)
      const colliders = buildColliders(this.nearObstacles(it.type, pose, under));
      const underChangedObbs = changedObbs.filter((_, i) => underChangeIdx[i] < clothIdx);
      const inst = this.instances.get(it.id);
      if (!inst) {
        const sim = new ClothSim(makeClothSpec(it.type), pose, colliders);
        sim.mesh.userData.itemId = it.id; // pointer picking hook
        this.group.add(sim.mesh);
        this.instances.set(it.id, { sim, notified: false, dirty: false });
        continue;
      }
      inst.sim.setColliders(colliders);
      const cur = inst.sim.pose;
      if (cur.x !== pose.x || cur.z !== pose.z || cur.yawDeg !== pose.yawDeg) {
        inst.sim.replace(pose, colliders); // cloth itself moved → full re-drop
        inst.notified = false;
      } else if (underChangedObbs.length && this.overlapsAny(inst.sim, underChangedObbs)) {
        // obstacle changed under it → full re-drop: everything beneath the
        // sheet must end up strictly under the drape (an in-place re-settle
        // can't climb over an object taller than where the fabric lies)
        inst.sim.replace(pose, colliders);
        inst.notified = false;
      }
    }

    this.prevObstacles.clear();
    for (const t of obstacles) {
      this.prevObstacles.set(t.id, { ...t });
    }
  }

  /** Obstacles whose footprint a cloth of this size could possibly touch. */
  private nearObstacles(type: 'clothA' | 'clothB', pose: Pose, obstacles: PlacedItem[]): PlacedItem[] {
    const dims = ITEM_DIMS[type];
    const reach = Math.hypot(dims.w, dims.d) / 2 + INVALIDATE_MARGIN;
    return obstacles.filter((o) => {
      const od = ITEM_DIMS[o.type];
      const r = reach + Math.hypot(od.w, od.d) / 2;
      return (pose.x - o.x) ** 2 + (pose.z - o.z) ** 2 <= r * r;
    });
  }

  /** Fixed-step accumulator (clamped catch-up). True when any mesh changed. */
  step(dtSeconds: number): boolean {
    this.stepCalls++;
    if (!this.isActive()) {
      this.acc = 0;
      return false;
    }
    this.acc = Math.min(this.acc + dtSeconds, MAX_CATCHUP_FRAMES * DT);
    let any = false;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.framesRun++;
      for (const inst of this.instances.values()) {
        if (inst.sim.stepFrame()) {
          inst.dirty = true;
          any = true;
        }
      }
    }
    if (any) {
      for (const inst of this.instances.values()) {
        if (inst.dirty) {
          inst.sim.updateMesh();
          inst.dirty = false;
        }
      }
      this.notifySettled();
    }
    return any;
  }

  isActive(): boolean {
    for (const inst of this.instances.values()) {
      if (inst.sim.state === 'settling') return true;
    }
    return false;
  }

  skipAll(): void {
    for (const inst of this.instances.values()) {
      if (inst.sim.state === 'settling') {
        inst.sim.skip();
        inst.dirty = false;
      }
    }
    this.notifySettled();
  }

  /** Hide a cloth's settled mesh while its flat ghost is being dragged. */
  setHidden(id: string | null): void {
    for (const [instId, inst] of this.instances) {
      inst.sim.mesh.visible = instId !== id;
    }
  }

  /** Settled report when available, analytic prediction while still falling. */
  getReport(id: string): DrapeReport | null {
    const inst = this.instances.get(id);
    if (!inst) return null;
    return (
      inst.sim.report ?? predictDrape(inst.sim.spec.type, inst.sim.pose, this.lastTables)
    );
  }

  onSettled(cb: SettledCb): void {
    this.cbs.push(cb);
  }

  /** How high the settled fabric of any EARLIER-placed cloth lifts an item
   * at (x,z) — so a plate set down after the linen rests on the linen. */
  mountLift(item: PlacedItem, _items: PlacedItem[]): number {
    const itemIdx = this.lastOrder.get(item.id);
    if (itemIdx === undefined) return 0;
    let lift = 0;
    for (const [id, inst] of this.instances) {
      const clothIdx = this.lastOrder.get(id);
      if (clothIdx === undefined || clothIdx > itemIdx) continue;
      const pos = inst.sim.grid.pos;
      const count = inst.sim.grid.count;
      let m = -1;
      for (let p = 0; p < count; p++) {
        if (Math.abs(pos[p * 3] - item.x) < 7 && Math.abs(pos[p * 3 + 2] - item.z) < 7) {
          m = Math.max(m, pos[p * 3 + 1]);
        }
      }
      if (m > lift) lift = m;
    }
    return lift;
  }

  /** QA: per-instance state summary. */
  debugStates(): string {
    const parts: string[] = [];
    for (const [id, inst] of this.instances) {
      const col = (inst.sim as unknown as { colliders: { n: number; topMax: number } }).colliders;
      parts.push(
        `${id.slice(0, 6)}:${inst.sim.state} slabs=${col.n} topMax=${col.topMax} coarse=${inst.sim.spec.coarse} t=${(inst.sim as unknown as { simTime: number }).simTime.toFixed(2)}`,
      );
    }
    return `inst=${this.instances.size} steps=${this.stepCalls} frames=${this.framesRun} [${parts.join(',')}]`;
  }

  /** QA: tallest cloth particle within r inches of (x,z), −1 if none. */
  debugMaxOver(x: number, z: number, r: number): number {
    let m = -1;
    for (const inst of this.instances.values()) {
      const pos = inst.sim.grid.pos;
      const count = inst.sim.grid.count;
      for (let p = 0; p < count; p++) {
        if (Math.abs(pos[p * 3] - x) < r && Math.abs(pos[p * 3 + 2] - z) < r) {
          m = Math.max(m, pos[p * 3 + 1]);
        }
      }
    }
    return m;
  }

  dispose(): void {
    for (const inst of this.instances.values()) {
      this.group.remove(inst.sim.mesh);
      inst.sim.dispose();
    }
    this.instances.clear();
    disposeClothResources();
    this.parent.remove(this.group);
  }

  private overlapsAny(sim: ClothSim, obbs: OBB[]): boolean {
    const bb = sim.getAABB();
    const clothObb = aabbToOBB(
      (bb.minX + bb.maxX) / 2,
      (bb.minZ + bb.maxZ) / 2,
      bb.maxX - bb.minX + 2 * INVALIDATE_MARGIN,
      bb.maxZ - bb.minZ + 2 * INVALIDATE_MARGIN
    );
    return obbs.some((o) => obbIntersectsOBB(clothObb, o, 0));
  }

  private notifySettled(): void {
    for (const [id, inst] of this.instances) {
      if (inst.sim.state === 'settled' && !inst.notified && inst.sim.report) {
        inst.notified = true;
        for (const cb of this.cbs) cb(id, inst.sim.report);
      }
    }
  }
}
