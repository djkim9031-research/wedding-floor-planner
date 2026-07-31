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
  private readonly prevTables = new Map<string, PlacedItem>();
  private readonly cbs: SettledCb[] = [];
  private lastTables: PlacedItem[] = [];
  private acc = 0;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.scale.setScalar(IN);
    parent.add(this.group);
  }

  /** Reconcile cloth instances with the placed items. `changedIds` narrows the
   * invalidation fan-out to the tables that actually moved/appeared/vanished;
   * omitted, changes are inferred from the previously seen table poses. */
  sync(items: PlacedItem[], changedIds?: string[]): void {
    const tables = items.filter((it) => isTable(it.type));
    const colliders = buildColliders(tables);
    this.lastTables = tables;

    let changed: string[];
    if (changedIds) {
      changed = changedIds.filter(
        (id) => this.prevTables.has(id) || tables.some((t) => t.id === id)
      );
    } else {
      changed = [];
      for (const t of tables) {
        const p = this.prevTables.get(t.id);
        if (!p || p.x !== t.x || p.z !== t.z || p.yawDeg !== t.yawDeg) changed.push(t.id);
      }
      for (const id of this.prevTables.keys()) {
        if (!tables.some((t) => t.id === id)) changed.push(id);
      }
    }

    // old + new footprints of every changed table
    const changedObbs: OBB[] = [];
    for (const id of changed) {
      const old = this.prevTables.get(id);
      if (old) changedObbs.push(obbFromPose(old, ITEM_DIMS[old.type]));
      const cur = tables.find((t) => t.id === id);
      if (cur) changedObbs.push(obbFromPose(cur, ITEM_DIMS[cur.type]));
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
      } else if (changedObbs.length && this.overlapsAny(inst.sim, changedObbs)) {
        inst.sim.invalidate(colliders); // table changed under it → re-settle in place
        inst.notified = false;
      }
    }

    this.prevTables.clear();
    for (const t of tables) {
      this.prevTables.set(t.id, { ...t });
    }
  }

  /** Fixed-step accumulator (clamped catch-up). True when any mesh changed. */
  step(dtSeconds: number): boolean {
    if (!this.isActive()) {
      this.acc = 0;
      return false;
    }
    this.acc = Math.min(this.acc + dtSeconds, MAX_CATCHUP_FRAMES * DT);
    let any = false;
    while (this.acc >= DT) {
      this.acc -= DT;
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
