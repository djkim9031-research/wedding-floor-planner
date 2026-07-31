import { ITEM_DIMS, SNAP, isTable } from '../constants';
import type { ItemType, PlacedItem, Pose, SnapResult, Vec2 } from '../types';
import { angleDeltaDeg, dist2, normalizeDeg, obbEdges, obbFromPose, type ObbEdge } from './geometry';

export function gridSnap(pose: Pose, step = SNAP.grid): Pose {
  return { ...pose, x: Math.round(pose.x / step) * step, z: Math.round(pose.z / step) * step };
}

export function angleSnap(pose: Pose, stepDeg = SNAP.angleDeg): Pose {
  return { ...pose, yawDeg: normalizeDeg(Math.round(pose.yawDeg / stepDeg) * stepDeg) };
}

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;

function span(edge: ObbEdge, t: Vec2, origin: Vec2): [number, number] {
  const a = dot({ x: edge.a.x - origin.x, z: edge.a.z - origin.z }, t);
  const b = dot({ x: edge.b.x - origin.x, z: edge.b.z - origin.z }, t);
  return a < b ? [a, b] : [b, a];
}

/**
 * Magnetic edge-to-edge snapping between the dragged table and placed tables.
 * Returns the corrected pose (flush contact, aligned yaw) or null when nothing
 * is in range. `engage` lets the caller implement hysteresis (4" to grab,
 * 6" to let go).
 */
export function edgeSnap(
  type: ItemType,
  pose: Pose,
  items: PlacedItem[],
  selfId?: string,
  engage = SNAP.engage,
): SnapResult | null {
  const dims = ITEM_DIMS[type];
  const diag = Math.hypot(dims.w, dims.d);
  const dragged = obbFromPose(pose, dims);
  const cosLimit = -Math.cos((SNAP.normalAlignDeg * Math.PI) / 180);

  interface Cand {
    other: PlacedItem;
    eT: ObbEdge;
    gap: number;
    score: number;
  }
  let best: Cand | null = null;

  for (const other of items) {
    if (!isTable(other.type) || other.id === selfId) continue;
    const oDims = ITEM_DIMS[other.type];
    const maxR = (diag + Math.hypot(oDims.w, oDims.d)) / 2 + engage;
    if (dist2({ x: pose.x, z: pose.z }, other) > maxR * maxR) continue;
    const oObb = obbFromPose(other, oDims);
    for (const eD of obbEdges(dragged)) {
      for (const eT of obbEdges(oObb)) {
        if (dot(eD.n, eT.n) > cosLimit) continue; // must roughly face each other
        const gap = dot({ x: eD.m.x - eT.m.x, z: eD.m.z - eT.m.z }, eT.n);
        if (gap < -1.5 || gap > engage) continue;
        const [d0, d1] = span(eD, eT.t, eT.m);
        const [t0, t1] = span(eT, eT.t, eT.m);
        const overlap = Math.min(d1, t1) - Math.max(d0, t0);
        if (overlap < SNAP.minEdgeOverlap) continue;
        const misalign = Math.abs(dot({ x: eD.m.x - eT.m.x, z: eD.m.z - eT.m.z }, eT.t));
        const score = Math.abs(gap) + 0.25 * misalign;
        if (!best || score < best.score) best = { other, eT, gap, score };
      }
    }
  }
  if (!best) return null;

  // Align yaw to the nearest 90° equivalent of the target's yaw.
  let yaw = best.other.yawDeg;
  let bestDelta = Infinity;
  for (let k = 0; k < 4; k++) {
    const cand = normalizeDeg(best.other.yawDeg + k * 90);
    const d = Math.abs(angleDeltaDeg(pose.yawDeg, cand));
    if (d < bestDelta) {
      bestDelta = d;
      yaw = cand;
    }
  }

  // Rebuild the dragged box at the aligned yaw and find its edge facing eT.
  const alignedPose: Pose = { x: pose.x, z: pose.z, yawDeg: yaw };
  const aligned = obbFromPose(alignedPose, dims);
  let eD: ObbEdge | null = null;
  let bestDot = Infinity;
  for (const e of obbEdges(aligned)) {
    const dd = dot(e.n, best.eT.n);
    if (dd < bestDot) {
      bestDot = dd;
      eD = e;
    }
  }
  if (!eD) return null;

  const eT = best.eT;
  // Translate along the target normal until flush.
  const gap = dot({ x: eD.m.x - eT.m.x, z: eD.m.z - eT.m.z }, eT.n);
  let cx = pose.x - eT.n.x * gap;
  let cz = pose.z - eT.n.z * gap;

  // Lateral alignment: corner magnet -> center magnet -> free rail.
  const t = eT.t;
  const shifted = (v: Vec2): Vec2 => ({ x: v.x - eT.n.x * gap, z: v.z - eT.n.z * gap });
  const dCorners = [shifted(eD.a), shifted(eD.b)];
  const tCorners = [eT.a, eT.b];
  let lateral: number | null = null;
  let cornerBest = Infinity;
  for (const dc of dCorners) {
    for (const tc of tCorners) {
      const off = dot({ x: tc.x - dc.x, z: tc.z - dc.z }, t);
      if (Math.abs(off) < SNAP.lateralMagnet && Math.abs(off) < cornerBest) {
        cornerBest = Math.abs(off);
        lateral = off;
      }
    }
  }
  if (lateral === null) {
    const mid = dot({ x: eT.m.x - (eD.m.x - eT.n.x * gap), z: eT.m.z - (eD.m.z - eT.n.z * gap) }, t);
    if (Math.abs(mid) < SNAP.lateralMagnet) lateral = mid;
  }
  if (lateral !== null) {
    cx += t.x * lateral;
    cz += t.z * lateral;
  }

  // Shared-edge highlight segment: overlap of the two edges along t.
  const fD = obbEdges(obbFromPose({ x: cx, z: cz, yawDeg: yaw }, dims)).reduce((acc, e) =>
    dot(e.n, eT.n) < dot(acc.n, eT.n) ? e : acc,
  );
  const [a0, a1] = span(fD, t, eT.m);
  const [b0, b1] = span(eT, t, eT.m);
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  const sharedEdge: [Vec2, Vec2] = [
    { x: eT.m.x + t.x * lo, z: eT.m.z + t.z * lo },
    { x: eT.m.x + t.x * hi, z: eT.m.z + t.z * hi },
  ];

  return { otherId: best.other.id, pose: { x: cx, z: cz, yawDeg: yaw }, sharedEdge };
}
