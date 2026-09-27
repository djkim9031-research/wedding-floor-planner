import {
  COLUMNS,
  DECK_TRUNKS,
  type TrunkFootprint,
  ITEM_DIMS,
  PENETRATION_EPS,
  PLACEMENT_AREAS,
  isBarrier,
  isFigure,
  isPlant,
  isPlanter,
  isTable,
} from '../constants';
import type { ItemType, PlacedItem, Pose, Vec2 } from '../types';
import { aabbToOBB, obbFromPose, obbIntersectsOBB, pointInPolygon, segmentIntersectsOBB, obbCorners } from './geometry';

/** Fully inside one placement zone: all corners in, no boundary crossing. */
function insideZone(corners: Vec2[], obb: ReturnType<typeof obbFromPose>, poly: Vec2[]): boolean {
  for (const c of corners) {
    if (!pointInPolygon(c, poly)) return false;
  }
  for (let i = 0; i < poly.length; i++) {
    if (segmentIntersectsOBB(poly[i], poly[(i + 1) % poly.length], obb)) return false;
  }
  return true;
}

/** Does a footprint (OBB corners, convex) overlap a trunk's elliptical deck
 * opening by more than `eps` inches? Works in the ellipse's unit-circle
 * frame: the OBB maps to a parallelogram, which overlaps the unit disc when
 * it contains the origin or passes within 1 − eps/r of it. */
export function obbOverlapsEllipse(corners: Vec2[], e: TrunkFootprint, eps = 0): boolean {
  const yaw = (e.rotDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // world → ellipse-local (inverse of the item-yaw rotation), then unit scale
  const q = corners.map((p) => {
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    return { x: (dx * c - dz * s) / e.rx, z: (dx * s + dz * c) / e.rz };
  });
  let pos = 0;
  let neg = 0;
  let minD = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    // edge × (origin − a): one sign for every edge ⇔ origin inside (either winding)
    const cross = ex * -a.z - ez * -a.x;
    if (cross > 0) pos++;
    else if (cross < 0) neg++;
    const len2 = ex * ex + ez * ez || 1e-12;
    const t = Math.max(0, Math.min(1, -(a.x * ex + a.z * ez) / len2));
    minD = Math.min(minD, Math.hypot(a.x + ex * t, a.z + ez * t));
  }
  if (pos === 0 || neg === 0) return true;
  return minD < 1 - eps / Math.max(e.rx, e.rz);
}

/**
 * Placement rules:
 *  - every item must sit fully inside the room polygon (no wall crossings)
 *  - nothing overlaps the two structural columns (except figures, which are
 *    visual aids only)
 *  - tables must not interpenetrate other tables (flush contact is fine)
 *  - chairs must not interpenetrate other chairs, but may tuck under tables
 *  - cloths may overlap tables, chairs, cloths, and figures freely
 */
export function isPoseValid(
  type: ItemType,
  pose: Pose,
  items: PlacedItem[],
  selfId?: string | string[],
  zones: Vec2[][] = PLACEMENT_AREAS,
): boolean {
  const excluded = typeof selfId === 'string' ? [selfId] : (selfId ?? []);
  const obb = obbFromPose(pose, ITEM_DIMS[type]);

  const corners = obbCorners(obb);
  if (!zones.some((poly) => insideZone(corners, obb, poly))) return false;
  if (zones !== PLACEMENT_AREAS) return true; // studio sandbox: only the zone bound applies

  if (isFigure(type)) return true;

  for (const col of COLUMNS) {
    if (obbIntersectsOBB(obb, aabbToOBB(col.cx, col.cz, col.size, col.size), PENETRATION_EPS)) {
      return false;
    }
  }
  for (const trunk of DECK_TRUNKS) {
    if (obbOverlapsEllipse(corners, trunk, PENETRATION_EPS)) return false;
  }

  // lanterns/settings are decor (may sit on tabletops); plants may overlap
  // planters (they sit inside them) but not each other — one plant per pot;
  // hedges, screens, and planters are solid and must not run through tables
  // or each other
  const collidesWith = (other: ItemType): boolean =>
    isTable(type)
      ? isTable(other) || isBarrier(other) || isPlanter(other)
      : type === 'chair'
        ? other === 'chair'
        : isBarrier(type)
          ? isBarrier(other) || isTable(other) || isPlanter(other)
          : isPlanter(type)
            ? isTable(other) || isBarrier(other) || isPlanter(other)
            : isPlant(type)
              ? isPlant(other)
              : false;

  for (const it of items) {
    if (excluded.includes(it.id) || !collidesWith(it.type)) continue;
    if (obbIntersectsOBB(obb, obbFromPose(it, ITEM_DIMS[it.type]), PENETRATION_EPS)) return false;
  }

  return true;
}
