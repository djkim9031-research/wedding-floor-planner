import {
  CHAIR_BACK_H,
  CHAIR_SEAT_H,
  FIGURE_HEIGHTS,
  HEDGE_H,
  ITEM_DIMS,
  LANTERN_SPECS,
  SCREEN_H,
  TABLE_TOPS,
  isFigure,
  isLantern,
  isTable,
  type LanternType,
} from '../constants';
import { DEG } from '../core/geometry';
import type { PlacedItem } from '../types';
import { FRICTION, LEG_CULL_XZ, LEG_INSET, LEG_R, PARTICLE_R, SLAB_T, WELD_EPS } from './constants';

/** Static collision world for one sim: box slabs (each with its own vertical
 * span), leg capsules, and the floor. Flat arrays so the hot loop stays
 * scalar. Every placed obstacle contributes one or more slabs, so linens
 * drape over chairs, hedges, screens, lanterns, settings, and guests — not
 * just tabletops. */
export interface Colliders {
  /** tables only — drape measurement still reasons about table blocks */
  tables: PlacedItem[];
  n: number;
  /** stride 10 per slab: cx, cz, cos(yaw), sin(yaw), hx, hz, topY,
   * sideBottomY (rim/side face extends down to here), ejectBelowY (fabric
   * caught inside the footprint above this is pushed out horizontally), and
   * renderBand (how far below topY render vertices get lifted back onto the
   * contact plane — deep for small tent-pole slabs where the smoothed render
   * surface undershoots the sharp apex, shallow for broad tabletops). */
  slab: Float64Array;
  nLeg: number;
  /** stride 3 per leg: world x, z, capsule top y. */
  legs: Float64Array;
  /** tallest slab top in this set (0 when empty). */
  topMax: number;
  /** particles below this can never touch a slab. */
  gate: number;
  /** render-band clamp early-out: lowest (top − SLAB_T) in the set. */
  bandMin: number;
}

const S10 = 10;
/** Footprint inflation ≈ fabric thickness (see buildColliders). */
const SKIN = 0.35;

/** Fabric may not tuck under a tabletop within this depth below its top —
 * keeps hanging panels plumb at the rim instead of curling in under it. */
const TUCK_DEPTH = 12;

interface SlabDef {
  ox: number; // local center offset (rotates with the item)
  oz: number;
  hx: number;
  hz: number;
  top: number;
  sideBottom: number;
  ejectBelow: number;
  /** render-clamp depth below top; defaults to SLAB_T */
  band?: number;
}

/** Tallest tabletop under (x,z) among the given items (0 = open floor) —
 * lanterns and settings mount there, so their colliders ride the same top. */
function mountTop(items: PlacedItem[], x: number, z: number): number {
  let top = 0;
  for (const it of items) {
    if (!isTable(it.type)) continue;
    const dims = ITEM_DIMS[it.type];
    const yaw = it.yawDeg * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = x - it.x;
    const dz = z - it.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) <= dims.w / 2 && Math.abs(lz) <= dims.d / 2) {
      top = Math.max(top, TABLE_TOPS[it.type]);
    }
  }
  return top;
}

/** Slabs for one obstacle, in its local frame (matching the render meshes). */
function slabsFor(it: PlacedItem, items: PlacedItem[]): SlabDef[] {
  const { w, d } = ITEM_DIMS[it.type];
  if (isTable(it.type)) {
    const top = TABLE_TOPS[it.type];
    return [
      { ox: 0, oz: 0, hx: w / 2, hz: d / 2, top, sideBottom: top - SLAB_T, ejectBelow: top - TUCK_DEPTH },
    ];
  }
  if (it.type === 'chair') {
    // seat pad + solid backrest plane; the back slab is inflated to cover the
    // rounded crest rail and the stiles' backward rake, so no wood pierces
    // fabric draped over the chair
    return [
      { ox: 0, oz: 0.75, hx: 9.5, hz: 7.75, top: CHAIR_SEAT_H, sideBottom: CHAIR_SEAT_H - 1.8, ejectBelow: CHAIR_SEAT_H - 1.8 },
      { ox: 0, oz: -7.6, hx: 9.5, hz: 1.5, top: CHAIR_BACK_H, sideBottom: CHAIR_SEAT_H, ejectBelow: CHAIR_SEAT_H, band: 3.5 },
    ];
  }
  if (it.type === 'hedge') {
    // +1: the leafy vertex noise pushes sprigs slightly above the box
    return [{ ox: 0, oz: 0, hx: w / 2, hz: d / 2, top: HEDGE_H + 1, sideBottom: 0, ejectBelow: 0 }];
  }
  if (it.type === 'screen') {
    return [
      { ox: 0, oz: 0, hx: 24, hz: 10.5, top: 21, sideBottom: 3, ejectBelow: 3 },
      { ox: 0, oz: 0, hx: 24, hz: 1, top: SCREEN_H, sideBottom: 15, ejectBelow: 15 },
    ];
  }
  if (isLantern(it.type)) {
    const m = mountTop(items, it.x, it.z);
    const h = LANTERN_SPECS[it.type as LanternType].h;
    // +1.4: the finial ball rides above the pitched cap
    return [{ ox: 0, oz: 0, hx: w / 2, hz: w / 2, top: m + h + 1.4, sideBottom: m, ejectBelow: m, band: 8 }];
  }
  if (it.type === 'setting') {
    const m = mountTop(items, it.x, it.z);
    return [
      { ox: -1.5, oz: 0, hx: 5.5, hz: 5.5, top: m + 2.4, sideBottom: m, ejectBelow: m, band: 3 }, // plate stack + menu
      { ox: 7, oz: -2.5, hx: 3, hz: 4.5, top: m + 8, sideBottom: m, ejectBelow: m, band: 6 }, // glassware
    ];
  }
  if (isFigure(it.type)) {
    const h = FIGURE_HEIGHTS[it.type as 'figureW' | 'figureM'];
    return [{ ox: 0, oz: 0, hx: w / 2 - 1, hz: d / 2 - 1, top: h + 0.5, sideBottom: 0, ejectBelow: 0, band: 7 }];
  }
  return [];
}

export function buildColliders(obstacles: PlacedItem[]): Colliders {
  const slabList: number[] = [];
  const legList: number[] = [];
  let topMax = 0;
  let gate = Infinity;
  let bandMin = Infinity;
  for (const t of obstacles) {
    const yaw = t.yawDeg * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // SKIN inflates non-table footprints by a fabric thickness so the draped
    // surface wraps outside the rendered wood — render verts over an edge
    // stay in-footprint where clampRenderBand can hold them up. Tabletops
    // keep exact dims: they never poke, and the drape readouts stay honest.
    const skin = isTable(t.type) ? 0 : SKIN;
    for (const sd of slabsFor(t, obstacles)) {
      // world = center + rot(local): rot(dx,dz) = (dx·c + dz·s, −dx·s + dz·c)
      slabList.push(
        t.x + sd.ox * c + sd.oz * s,
        t.z - sd.ox * s + sd.oz * c,
        c,
        s,
        sd.hx + skin,
        sd.hz + skin,
        sd.top,
        sd.sideBottom,
        sd.ejectBelow,
        sd.band ?? SLAB_T,
      );
      if (sd.top > topMax) topMax = sd.top;
      const low = Math.min(sd.sideBottom, sd.ejectBelow);
      if (low < gate) gate = low;
      if (sd.top - (sd.band ?? SLAB_T) < bandMin) bandMin = sd.top - (sd.band ?? SLAB_T);
    }
    if (isTable(t.type)) {
      const dims = ITEM_DIMS[t.type];
      const top = TABLE_TOPS[t.type];
      const lx = dims.w / 2 - LEG_INSET;
      const lz = dims.d / 2 - LEG_INSET;
      for (let sxn = -1; sxn <= 1; sxn += 2) {
        for (let szn = -1; szn <= 1; szn += 2) {
          legList.push(t.x + sxn * lx * c + szn * lz * s, t.z - sxn * lx * s + szn * lz * c, top - SLAB_T);
        }
      }
    }
  }
  const n = slabList.length / S10;
  return {
    tables: obstacles.filter((t) => isTable(t.type)),
    n,
    slab: Float64Array.from(slabList),
    nLeg: legList.length / 3,
    legs: Float64Array.from(legList),
    topMax,
    gate: n === 0 ? Infinity : gate - PARTICLE_R,
    bandMin: n === 0 ? Infinity : bandMin,
  };
}

/** Tallest slab top containing (x,z), or -1 when over open floor. */
export function topAt(col: Colliders, x: number, z: number): number {
  const sl = col.slab;
  let best = -1;
  for (let k = 0; k < col.n; k++) {
    const o = k * S10;
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
    const o = k * S10;
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
    const o = k * S10;
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
  const nLeg = col.nLeg;

  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    const x = pos[i3];
    const y = pos[i3 + 1];
    const z = pos[i3 + 2];

    // --- slabs: in-footprint pushout is vertical (per-slab top plane) ---
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
      let bqBottom = 0;
      for (let k = 0; k < nSlab; k++) {
        const o = k * S10;
        const dx = x - sl[o];
        const dz = z - sl[o + 1];
        const c = sl[o + 2];
        const s = sl[o + 3];
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const hx = sl[o + 4];
        const hz = sl[o + 5];
        if (lx >= -hx - WELD_EPS && lx <= hx + WELD_EPS && lz >= -hz - WELD_EPS && lz <= hz + WELD_EPS) {
          // only slabs whose vertical influence reaches this particle count —
          // fabric above a low slab is just falling, not caught inside it
          if (y >= sl[o + 6] + R || y <= sl[o + 8]) continue;
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
        // closest point on the (uninflated) footprint edge, for the side wrap
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
          bqBottom = sl[o + 7];
        }
      }
      if (inO >= 0) {
        const topContact = inTop + R;
        if (y < topContact) {
          if (y > inTop - SLAB_T - R && prev[i3 + 1] >= inTop) {
            // arrived from above: settle onto this slab's top plane
            const depth = topContact - y;
            pos[i3 + 1] = topContact;
            applyFriction(pos, prev, i3, 0, 1, 0, depth, FRICTION.table.s, FRICTION.table.k);
          } else if (inCount === 1) {
            // (seam strips contained by 2+ slabs are left alone: fabric resting
            // on the shorter top there must not be eject-fought forever)
            // curled in from the side (rim wrap under tension) or inside a
            // solid body: eject horizontally through the nearest face —
            // never teleport up
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
        // rounded-edge wrap around the nearest slab's rim + side face down to
        // its sideBottom (tables: just the top slab; hedges/screens: full wall)
        const qy = y < bqBottom ? bqBottom : y > bqTop ? bqTop : y;
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
    // only re-flatten particles the self-pass nudged just below a top plane;
    // side-curled particles are left to the full collision pass
    if (nSlab === 0 || y >= col.topMax + R || y <= col.gate) continue;
    const top = topAt(col, pos[i3], pos[i3 + 2]);
    if (top > 0 && y > top && y < top + R) pos[i3 + 1] = top + R;
  }
}

/** Render-mesh helper: subdivided surface chords can sag below a slab top
 * between contact particles near its rim, letting the solid poke through the
 * fabric. Lift any render vertex that sits over a footprint but below the
 * contact plane. Sim positions are never touched. */
export function clampRenderBand(pos: Float32Array, count: number, col: Colliders): void {
  if (col.n === 0) return;
  const sl = col.slab;
  const yMin = col.bandMin - SLAB_T;
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
      const o = k * S10;
      const dx = x - sl[o];
      const dz = z - sl[o + 1];
      const c = sl[o + 2];
      const s = sl[o + 3];
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const ex = Math.abs(lx) - sl[o + 4];
      const ez = Math.abs(lz) - sl[o + 5];
      if (ex <= WELD_EPS && ez <= WELD_EPS) {
        // only slabs whose top is near this vertex (within the slab's own
        // render band) — a vertex halfway down a hedge wall must not be
        // lifted to the hedge crown
        if (sl[o + 6] > inTop && y > sl[o + 6] - sl[o + 9] && sl[o + 6] > 0) inTop = sl[o + 6];
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
      if (y < yTop) pos[i3 + 1] = yTop;
    } else if (nearD2 < 1.44) {
      // fold crest hovering just past the rim: settle it onto the rim so the
      // slab edge can't peek through at raking angles
      const yTop = nearTop + PARTICLE_R;
      if (y > yTop && y < yTop + 1.2) pos[i3 + 1] = yTop;
    }
  }
}
