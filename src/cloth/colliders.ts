import { ITEM_DIMS, TABLE_TOPS, isTable } from '../constants';
import { DEG } from '../core/geometry';
import type { PlacedItem } from '../types';
import { FRICTION, LEG_CULL_XZ, LEG_INSET, LEG_R, PARTICLE_R, SLAB_T, WELD_EPS } from './constants';

/** Static collision world for one sim: tabletop slabs (shared top plane),
 * leg capsules, and the floor. Flat arrays so the hot loop stays scalar. */
export interface Colliders {
  tables: PlacedItem[];
  n: number;
  /** stride 7 per slab: cx, cz, cos(yaw), sin(yaw), hx, hz, topY (uninflated). */
  slab: Float64Array;
  /** stride 3 per leg: world x, z, capsule top y. 4 legs per slab. */
  legs: Float64Array;
  /** tallest tabletop in this set (0 when empty). */
  topMax: number;
  /** particles below this can never touch a slab (tuck guard included). */
  gate: number;
}

export function buildColliders(tables: PlacedItem[]): Colliders {
  const n = tables.length;
  const slab = new Float64Array(n * 7);
  const legs = new Float64Array(n * 12);
  let topMax = 0;
  let topMin = Infinity;
  for (let k = 0; k < n; k++) {
    const t = tables[k];
    const dims = ITEM_DIMS[t.type];
    const top = isTable(t.type) ? TABLE_TOPS[t.type] : 0;
    const hx = dims.w / 2;
    const hz = dims.d / 2;
    const yaw = t.yawDeg * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    slab[k * 7] = t.x;
    slab[k * 7 + 1] = t.z;
    slab[k * 7 + 2] = c;
    slab[k * 7 + 3] = s;
    slab[k * 7 + 4] = hx;
    slab[k * 7 + 5] = hz;
    slab[k * 7 + 6] = top;
    if (top > topMax) topMax = top;
    if (top < topMin) topMin = top;
    const lx = hx - LEG_INSET;
    const lz = hz - LEG_INSET;
    let li = k * 12;
    for (let sxn = -1; sxn <= 1; sxn += 2) {
      for (let szn = -1; szn <= 1; szn += 2) {
        // world = center + rot(local): rot(dx,dz) = (dx·c + dz·s, −dx·s + dz·c)
        legs[li++] = t.x + sxn * lx * c + szn * lz * s;
        legs[li++] = t.z - sxn * lx * s + szn * lz * c;
        legs[li++] = top - SLAB_T; // capsule stops under the slab
      }
    }
  }
  const gate = n === 0 ? Infinity : topMin - TUCK_DEPTH;
  return { tables, n, slab, legs, topMax, gate };
}

/** Tallest tabletop containing (x,z), or -1 when over open floor. */
export function topAt(col: Colliders, x: number, z: number): number {
  const sl = col.slab;
  let best = -1;
  for (let k = 0; k < col.n; k++) {
    const o = k * 7;
    const dx = x - sl[o];
    const dz = z - sl[o + 1];
    const c = sl[o + 2];
    const s = sl[o + 3];
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (
      lx >= -sl[o + 4] - WELD_EPS &&
      lx <= sl[o + 4] + WELD_EPS &&
      lz >= -sl[o + 5] - WELD_EPS &&
      lz <= sl[o + 5] + WELD_EPS &&
      sl[o + 6] > best
    ) {
      best = sl[o + 6];
    }
  }
  return best;
}

/** Point-in-union test over the WELD_EPS-inflated footprints. */
export function unionContains2D(col: Colliders, x: number, z: number): boolean {
  const sl = col.slab;
  for (let k = 0; k < col.n; k++) {
    const o = k * 7;
    const dx = x - sl[o];
    const dz = z - sl[o + 1];
    const c = sl[o + 2];
    const s = sl[o + 3];
    const lx = dx * c - dz * s; // unrot(): world → slab local
    const lz = dx * s + dz * c;
    if (
      lx >= -sl[o + 4] - WELD_EPS &&
      lx <= sl[o + 4] + WELD_EPS &&
      lz >= -sl[o + 5] - WELD_EPS &&
      lz <= sl[o + 5] + WELD_EPS
    ) {
      return true;
    }
  }
  return false;
}

/** Distance from (x,z) to the union footprint; 0 when inside. */
export function distToUnion2D(col: Colliders, x: number, z: number): number {
  let best = Infinity;
  const sl = col.slab;
  for (let k = 0; k < col.n; k++) {
    const o = k * 7;
    const dx = x - sl[o];
    const dz = z - sl[o + 1];
    const c = sl[o + 2];
    const s = sl[o + 3];
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const ex = Math.abs(lx) - sl[o + 4];
    const ez = Math.abs(lz) - sl[o + 5];
    if (ex <= WELD_EPS && ez <= WELD_EPS) return 0;
    const ox = Math.max(ex, 0);
    const oz = Math.max(ez, 0);
    const d = Math.sqrt(ox * ox + oz * oz);
    if (d < best) best = d;
  }
  return best === Infinity ? Infinity : best;
}

const R = PARTICLE_R;
/** Fabric may not tuck under a slab within this depth below its top — keeps
 * hanging panels plumb at the rim instead of curling in under the overhang. */
const TUCK_DEPTH = 12;
const RR_LEG = LEG_R + PARTICLE_R;

/** PBD friction: remove/scale the tangential part of this substep's motion.
 * Static when the tangential slide is small vs. μs·depth, kinetic otherwise. */
function applyFriction(
  pos: Float32Array,
  prev: Float32Array,
  i3: number,
  nx: number,
  ny: number,
  nz: number,
  depth: number,
  mus: number,
  muk: number
): void {
  let tx = pos[i3] - prev[i3];
  let ty = pos[i3 + 1] - prev[i3 + 1];
  let tz = pos[i3 + 2] - prev[i3 + 2];
  const tn = tx * nx + ty * ny + tz * nz;
  tx -= tn * nx;
  ty -= tn * ny;
  tz -= tn * nz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-9) return;
  let f = 1;
  if (tl >= mus * depth) {
    f = Math.min((muk * depth) / tl, 1);
  }
  pos[i3] -= tx * f;
  pos[i3 + 1] -= ty * f;
  pos[i3 + 2] -= tz * f;
}

/** One collision pass over all particles (called once per substep, after the
 * constraint solve). prev = positions at substep start (for friction). */
export function collideSubstep(pos: Float32Array, prev: Float32Array, count: number, col: Colliders): void {
  const sl = col.slab;
  const legs = col.legs;
  const nSlab = col.n;
  const nLeg = nSlab * 4;

  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    const x = pos[i3];
    const y = pos[i3 + 1];
    const z = pos[i3 + 2];

    // --- tabletop slabs: in-union pushout is vertical (per-slab top plane) ---
    if (nSlab > 0 && y > col.gate) {
      let inTop = -Infinity;
      let inO = -1;
      let inCount = 0;
      let inLx = 0;
      let inLz = 0;
      let bestD2 = Infinity;
      let bqx = 0;
      let bqz = 0;
      let bqTop = 0;
      for (let k = 0; k < nSlab; k++) {
        const o = k * 7;
        const dx = x - sl[o];
        const dz = z - sl[o + 1];
        const c = sl[o + 2];
        const s = sl[o + 3];
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const hx = sl[o + 4];
        const hz = sl[o + 5];
        if (lx >= -hx - WELD_EPS && lx <= hx + WELD_EPS && lz >= -hz - WELD_EPS && lz <= hz + WELD_EPS) {
          // at a mixed-height seam the taller top wins
          inCount++;
          if (sl[o + 6] > inTop) {
            inTop = sl[o + 6];
            inO = o;
            inLx = lx;
            inLz = lz;
          }
          continue;
        }
        // closest point on the (uninflated) footprint edge, for the edge wrap
        const qlx = lx < -hx ? -hx : lx > hx ? hx : lx;
        const qlz = lz < -hz ? -hz : lz > hz ? hz : lz;
        const qx = sl[o] + qlx * c + qlz * s;
        const qz = sl[o + 1] - qlx * s + qlz * c;
        const ddx = x - qx;
        const ddz = z - qz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bqx = qx;
          bqz = qz;
          bqTop = sl[o + 6];
        }
      }
      if (inO >= 0) {
        const topContact = inTop + R;
        if (y < topContact && y > inTop - TUCK_DEPTH) {
          if (y > inTop - SLAB_T - R && prev[i3 + 1] >= inTop) {
            // arrived from above: settle onto this slab's top plane
            const depth = topContact - y;
            pos[i3 + 1] = topContact;
            applyFriction(pos, prev, i3, 0, 1, 0, depth, FRICTION.table.s, FRICTION.table.k);
          } else if (inCount === 1) {
            // (seam strips contained by 2+ slabs are left alone: fabric resting
            // on the shorter top there must not be eject-fought forever)
            // curled in from the side (rim wrap under tension): eject
            // horizontally through the nearest face — never teleport up
            const hxE = sl[inO + 4] + WELD_EPS;
            const hzE = sl[inO + 5] + WELD_EPS;
            const dxp = hxE - inLx;
            const dxm = inLx + hxE;
            const dzp = hzE - inLz;
            const dzm = inLz + hzE;
            let nlx = 1;
            let nlz = 0;
            let d = dxp;
            if (dxm < d) {
              d = dxm;
              nlx = -1;
            }
            if (dzp < d) {
              d = dzp;
              nlx = 0;
              nlz = 1;
            }
            if (dzm < d) {
              d = dzm;
              nlx = 0;
              nlz = -1;
            }
            if (d > 0.5) d = 0.5; // deep strays walk out over a few substeps
            const c = sl[inO + 2];
            const s = sl[inO + 3];
            const wnx = nlx * c + nlz * s; // rot(local face normal)
            const wnz = -nlx * s + nlz * c;
            pos[i3] += wnx * d;
            pos[i3 + 2] += wnz * d;
            // velocity-neutral: an inch-scale teleport must not become a
            // ~240 in/s kick when velocities are rebuilt from (pos - prev)
            prev[i3] += wnx * d;
            prev[i3 + 2] += wnz * d;
            applyFriction(pos, prev, i3, wnx, 0, wnz, d, FRICTION.table.s, FRICTION.table.k);
          }
        }
      } else if (bestD2 < R * R) {
        // rounded-edge wrap around the nearest slab's rim
        const qy = y < bqTop - SLAB_T ? bqTop - SLAB_T : y > bqTop ? bqTop : y;
        const dy = y - qy;
        const d3sq = bestD2 + dy * dy;
        if (d3sq < R * R && d3sq > 1e-12) {
          const d3 = Math.sqrt(d3sq);
          const inv = 1 / d3;
          const nx = (x - bqx) * inv;
          const ny = dy * inv;
          const nz = (z - bqz) * inv;
          const depth = R - d3;
          pos[i3] += nx * depth;
          pos[i3 + 1] += ny * depth;
          pos[i3 + 2] += nz * depth;
          applyFriction(pos, prev, i3, nx, ny, nz, depth, FRICTION.table.s, FRICTION.table.k);
        }
      }
    }

    // --- leg capsules ---
    if (nLeg > 0 && pos[i3 + 1] < col.topMax - SLAB_T + RR_LEG) {
      for (let k = 0; k < nLeg; k++) {
        const px = pos[i3];
        const py = pos[i3 + 1];
        const pz = pos[i3 + 2];
        const dx = px - legs[k * 3];
        if (dx > LEG_CULL_XZ || dx < -LEG_CULL_XZ) continue;
        const dz = pz - legs[k * 3 + 1];
        if (dz > LEG_CULL_XZ || dz < -LEG_CULL_XZ) continue;
        const legTop = legs[k * 3 + 2];
        const qy = py < 0 ? 0 : py > legTop ? legTop : py;
        const dy = py - qy;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < RR_LEG * RR_LEG && d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const inv = 1 / d;
          const nx = dx * inv;
          const ny = dy * inv;
          const nz = dz * inv;
          const depth = RR_LEG - d;
          pos[i3] += nx * depth;
          pos[i3 + 1] += ny * depth;
          pos[i3 + 2] += nz * depth;
          applyFriction(pos, prev, i3, nx, ny, nz, depth, FRICTION.leg.s, FRICTION.leg.k);
        }
      }
    }

    // --- floor ---
    if (pos[i3 + 1] < R) {
      const depth = R - pos[i3 + 1];
      pos[i3 + 1] = R;
      applyFriction(pos, prev, i3, 0, 1, 0, depth, FRICTION.floor.s, FRICTION.floor.k);
    }
  }
}

/** Cheap vertical-only re-projection (floor + slab band) after self-collision. */
export function projectContacts(pos: Float32Array, count: number, col: Colliders): void {
  const nSlab = col.n;
  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    const y = pos[i3 + 1];
    if (y < R) pos[i3 + 1] = R;
    // only re-flatten particles the self-pass nudged just below the top plane;
    // side-curled particles are left to the full collision pass
    if (nSlab === 0 || y >= col.topMax + R || y <= col.gate + TUCK_DEPTH) continue;
    const top = topAt(col, pos[i3], pos[i3 + 2]);
    if (top > 0 && y > top && y < top + R) pos[i3 + 1] = top + R;
  }
}

/** Render-mesh helper: subdivided surface chords can sag below the tabletop
 * between contact particles near a slab rim, letting the oak poke through the
 * fabric. Lift any render vertex that sits over a footprint but below the
 * contact plane. Sim positions are never touched. */
export function clampRenderBand(pos: Float32Array, count: number, col: Colliders): void {
  if (col.n === 0) return;
  const sl = col.slab;
  const yMin = col.gate + TUCK_DEPTH - SLAB_T;
  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    const y = pos[i3 + 1];
    if (y <= yMin || y > col.topMax + PARTICLE_R + 1.2) continue;
    const x = pos[i3];
    const z = pos[i3 + 2];
    let inTop = -Infinity;
    let nearD2 = Infinity;
    let nearTop = 0;
    for (let k = 0; k < col.n; k++) {
      const o = k * 7;
      const dx = x - sl[o];
      const dz = z - sl[o + 1];
      const c = sl[o + 2];
      const s = sl[o + 3];
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const ex = Math.abs(lx) - sl[o + 4];
      const ez = Math.abs(lz) - sl[o + 5];
      if (ex <= WELD_EPS && ez <= WELD_EPS) {
        if (sl[o + 6] > inTop) inTop = sl[o + 6];
      } else {
        const ox = Math.max(ex, 0);
        const oz = Math.max(ez, 0);
        const d2 = ox * ox + oz * oz;
        if (d2 < nearD2) {
          nearD2 = d2;
          nearTop = sl[o + 6];
        }
      }
    }
    if (inTop > 0) {
      // sagging chord over a footprint: lift back onto the contact plane
      const yTop = inTop + PARTICLE_R;
      if (y < yTop && y > inTop - SLAB_T) pos[i3 + 1] = yTop;
    } else if (nearD2 < 1.44) {
      // fold crest hovering just past the rim: settle it onto the rim so the
      // slab edge can't peek through at raking angles
      const yTop = nearTop + PARTICLE_R;
      if (y > yTop && y < yTop + 1.2) pos[i3 + 1] = yTop;
    }
  }
}
