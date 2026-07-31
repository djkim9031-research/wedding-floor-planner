import { DEG, rot } from '../core/geometry';
import type { Pose } from '../types';
import { NOISE_XZ, NOISE_Y } from './constants';
import { mulberry32 } from './prng';

/** Particle grid + distance-constraint sets for one cloth. Typed arrays only;
 * `pos` is also used directly as the sim-resolution render attribute. */
export interface ClothGrid {
  w: number;
  d: number;
  nx: number; // particles across local x
  nz: number; // particles across local z
  sx: number; // rest spacing along x (exact fit)
  sz: number; // rest spacing along z
  spacing: number; // min(sx, sz) — used for VMAX and self-collision radius
  count: number;
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  structPairs: Uint32Array;
  structRests: Float32Array;
  shearPairs: Uint32Array;
  shearRests: Float32Array;
  bendPairs: Uint32Array;
  bendRests: Float32Array;
}

export function buildGrid(w: number, d: number, targetSpacing: number): ClothGrid {
  const segsX = Math.max(1, Math.round(w / targetSpacing));
  const segsZ = Math.max(1, Math.round(d / targetSpacing));
  const nx = segsX + 1;
  const nz = segsZ + 1;
  const sx = w / segsX;
  const sz = d / segsZ;
  const count = nx * nz;

  const nStruct = segsX * nz + nx * segsZ;
  const nShear = 2 * segsX * segsZ;
  const nBend = (nx > 2 ? (nx - 2) * nz : 0) + (nz > 2 ? nx * (nz - 2) : 0);

  const g: ClothGrid = {
    w,
    d,
    nx,
    nz,
    sx,
    sz,
    spacing: Math.min(sx, sz),
    count,
    pos: new Float32Array(count * 3),
    prev: new Float32Array(count * 3),
    vel: new Float32Array(count * 3),
    structPairs: new Uint32Array(nStruct * 2),
    structRests: new Float32Array(nStruct),
    shearPairs: new Uint32Array(nShear * 2),
    shearRests: new Float32Array(nShear),
    bendPairs: new Uint32Array(nBend * 2),
    bendRests: new Float32Array(nBend),
  };

  const diag = Math.sqrt(sx * sx + sz * sz);
  let s = 0;
  let sh = 0;
  let b = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = ix + iz * nx;
      if (ix + 1 < nx) {
        g.structPairs[s * 2] = i;
        g.structPairs[s * 2 + 1] = i + 1;
        g.structRests[s++] = sx;
      }
      if (iz + 1 < nz) {
        g.structPairs[s * 2] = i;
        g.structPairs[s * 2 + 1] = i + nx;
        g.structRests[s++] = sz;
      }
      if (ix + 1 < nx && iz + 1 < nz) {
        g.shearPairs[sh * 2] = i;
        g.shearPairs[sh * 2 + 1] = i + nx + 1;
        g.shearRests[sh++] = diag;
        g.shearPairs[sh * 2] = i + 1;
        g.shearPairs[sh * 2 + 1] = i + nx;
        g.shearRests[sh++] = diag;
      }
      if (ix + 2 < nx) {
        g.bendPairs[b * 2] = i;
        g.bendPairs[b * 2 + 1] = i + 2;
        g.bendRests[b++] = 2 * sx;
      }
      if (iz + 2 < nz) {
        g.bendPairs[b * 2] = i;
        g.bendPairs[b * 2 + 1] = i + 2 * nx;
        g.bendRests[b++] = 2 * sz;
      }
    }
  }
  return g;
}

/** Lay the grid out flat at the pose, hovering at baseY, with seeded noise so
 * folds are varied but reproducible. Resets prev and vel. */
export function initPositions(g: ClothGrid, pose: Pose, baseY: number, seed: number): void {
  const rng = mulberry32(seed);
  const yaw = pose.yawDeg * DEG;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hw = g.w / 2;
  const hd = g.d / 2;
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i3 = (ix + iz * g.nx) * 3;
      const lx = -hw + ix * g.sx;
      const lz = -hd + iz * g.sz;
      // world = pose + rot(local); see core/geometry rot() for the yaw convention
      const wx = pose.x + lx * c + lz * s;
      const wz = pose.z - lx * s + lz * c;
      g.pos[i3] = wx + (rng() * 2 - 1) * NOISE_XZ;
      g.pos[i3 + 1] = baseY + (rng() * 2 - 1) * NOISE_Y;
      g.pos[i3 + 2] = wz + (rng() * 2 - 1) * NOISE_XZ;
    }
  }
  g.prev.set(g.pos);
  g.vel.fill(0);
}

/** Outward world-space normal of a cloth-local edge direction (unit 2D). */
export function edgeNormalWorld(pose: Pose, lx: number, lz: number): { x: number; z: number } {
  return rot(lx, lz, pose.yawDeg * DEG);
}
