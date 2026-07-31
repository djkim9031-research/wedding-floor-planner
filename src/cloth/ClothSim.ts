import type * as THREE from 'three';
import type { DrapeReport, Pose } from '../types';
import {
  DROP_HEIGHT,
  DT,
  HARD_CAP_S,
  INVALIDATE_CLOCK_S,
  SELF_R_FACTOR,
  SLEEP_AVG_DISP,
  SLEEP_FRAMES,
  SLEEP_MAX_DISP,
  SUBSTEPS,
  type ClothSpec,
} from './constants';
import { clampRenderBand, collideSubstep, projectContacts, topAt, type Colliders } from './colliders';
import { ClothRenderMesh } from './clothMesh';
import { measureDrape } from './measure';
import { buildGrid, initPositions, type ClothGrid } from './particles';
import { poseSeed } from './prng';
import { SelfCollider } from './selfCollision';
import { integrate, solveConstraints, updateVelocities } from './solver';

export type ClothState = 'settling' | 'settled';

/** One cloth instance: grid, XPBD stepping, settle detection, render mesh.
 * All positions are in inches (the manager's group carries the IN scale). */
export class ClothSim {
  readonly spec: ClothSpec;
  pose: Pose;
  state: ClothState = 'settling';
  report: DrapeReport | null = null;

  private readonly grid: ClothGrid;
  private readonly render: ClothRenderMesh;
  private readonly self: SelfCollider | null;
  private readonly frameStart: Float32Array;
  private colliders: Colliders;
  private simTime = 0;
  private sleepCount = 0;

  constructor(spec: ClothSpec, pose: Pose, colliders: Colliders, seed?: number) {
    this.spec = spec;
    this.pose = pose;
    this.colliders = colliders;
    this.grid = buildGrid(spec.w, spec.d, spec.spacing);
    this.frameStart = new Float32Array(this.grid.pos.length);
    this.self = spec.coarse ? null : new SelfCollider(this.grid.count);
    this.render = new ClothRenderMesh(
      this.grid.pos,
      this.grid.nx,
      this.grid.nz,
      this.grid.sx,
      this.grid.sz,
      spec.color,
      !spec.coarse
    );
    this.render.clamp = (pos, count) => clampRenderBand(pos, count, this.colliders);
    this.drop(pose, seed);
  }

  get mesh(): THREE.Mesh {
    return this.render.mesh;
  }

  /** Advance one fixed 1/60s frame. Returns false once settled. */
  stepFrame(): boolean {
    if (this.state === 'settled') return false;
    const g = this.grid;
    const h = DT / SUBSTEPS;
    this.frameStart.set(g.pos);

    for (let s = 0; s < SUBSTEPS; s++) {
      integrate(g, h, this.simTime);
      solveConstraints(g, h);
      collideSubstep(g.pos, g.prev, g.count, this.colliders);
      updateVelocities(g, h);
    }
    if (this.self) {
      this.self.apply(g.pos, g.count, g.nx, SELF_R_FACTOR * g.spacing);
      projectContacts(g.pos, g.count, this.colliders);
    }
    this.simTime += DT;

    // sleep detection over the whole frame's displacement
    let sum = 0;
    let maxD = 0;
    const fs = this.frameStart;
    for (let p = 0; p < g.count; p++) {
      const i3 = p * 3;
      const dx = g.pos[i3] - fs[i3];
      const dy = g.pos[i3 + 1] - fs[i3 + 1];
      const dz = g.pos[i3 + 2] - fs[i3 + 2];
      const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      sum += dd;
      if (dd > maxD) maxD = dd;
    }
    if (sum / g.count < SLEEP_AVG_DISP && maxD < SLEEP_MAX_DISP) {
      this.sleepCount++;
    } else {
      this.sleepCount = 0;
    }
    if (this.sleepCount >= SLEEP_FRAMES || this.simTime >= HARD_CAP_S) {
      this.freeze();
    }
    return true;
  }

  /** Push current positions (and normals) to the render mesh. */
  updateMesh(): void {
    this.render.update();
  }

  /** Fast-forward to the settled state synchronously (chunked; bounded by the
   * hard time cap, so at most a few hundred frames). */
  skip(): void {
    while (this.state === 'settling') {
      for (let k = 0; k < 30 && this.state === 'settling'; k++) this.stepFrame();
    }
    this.updateMesh();
  }

  /** A table under the cloth changed: keep positions, drop the cloth in place. */
  invalidate(colliders: Colliders): void {
    this.colliders = colliders;
    this.grid.vel.fill(0);
    this.simTime = INVALIDATE_CLOCK_S; // damping ramps in quickly on re-sims
    this.sleepCount = 0;
    this.state = 'settling';
    this.report = null;
  }

  /** Swap the collision world without restarting (settled cloths keep it for
   * a later invalidate; active cloths pick it up next frame). */
  setColliders(colliders: Colliders): void {
    this.colliders = colliders;
  }

  /** The cloth itself moved: full re-drop at the new pose. */
  replace(pose: Pose, colliders?: Colliders): void {
    if (colliders) this.colliders = colliders;
    this.drop(pose);
    this.updateMesh();
  }

  /** Current particle bounds in the floor plane (for invalidation fan-out). */
  getAABB(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const pos = this.grid.pos;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let p = 0; p < this.grid.count; p++) {
      const x = pos[p * 3];
      const z = pos[p * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minZ, maxZ };
  }

  dispose(): void {
    this.render.dispose();
  }

  private drop(pose: Pose, seed?: number): void {
    this.pose = pose;
    // sample the center and the cloth's corners: a cloth centered past a table
    // edge must still spawn above the tabletop, not inside it
    const yawRad = (pose.yawDeg * Math.PI) / 180;
    let top = topAt(this.colliders, pose.x, pose.z);
    const hw = this.spec.w / 2;
    const hd = this.spec.d / 2;
    const cs = Math.cos(yawRad);
    const sn = Math.sin(yawRad);
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]) {
      const wx = pose.x + sx * hw * cs + sz * hd * sn;
      const wz = pose.z - sx * hw * sn + sz * hd * cs;
      const t = topAt(this.colliders, wx, wz);
      if (t > top) top = t;
    }
    const baseY = (top > 0 ? top : 0) + DROP_HEIGHT;
    initPositions(
      this.grid,
      pose,
      baseY,
      seed ?? poseSeed(this.spec.type, pose.x, pose.z, pose.yawDeg)
    );
    this.simTime = 0;
    this.sleepCount = 0;
    this.state = 'settling';
    this.report = null;
  }

  private freeze(): void {
    this.grid.vel.fill(0);
    this.state = 'settled';
    this.report = measureDrape(this.grid, this.pose, this.colliders);
    this.updateMesh();
  }
}
