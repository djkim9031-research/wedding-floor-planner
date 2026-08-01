import {
  COLUMNS,
  DECK_TREES,
  ITEM_DIMS,
  PENETRATION_EPS,
  PLACEMENT_AREAS,
  isBarrier,
  isFigure,
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
): boolean {
  const excluded = typeof selfId === 'string' ? [selfId] : (selfId ?? []);
  const obb = obbFromPose(pose, ITEM_DIMS[type]);

  const corners = obbCorners(obb);
  if (!PLACEMENT_AREAS.some((poly) => insideZone(corners, obb, poly))) return false;

  if (isFigure(type)) return true;

  for (const col of COLUMNS) {
    if (obbIntersectsOBB(obb, aabbToOBB(col.cx, col.cz, col.size, col.size), PENETRATION_EPS)) {
      return false;
    }
  }
  for (const tree of DECK_TREES) {
    if (obbIntersectsOBB(obb, aabbToOBB(tree.x, tree.z, 30, 30), PENETRATION_EPS)) {
      return false;
    }
  }

  // lanterns/settings are decor (may sit on tabletops); hedges and screens
  // are solid and must not run through tables or each other
  const collidesWith = (other: ItemType): boolean =>
    isTable(type)
      ? isTable(other) || isBarrier(other)
      : type === 'chair'
        ? other === 'chair'
        : isBarrier(type)
          ? isBarrier(other) || isTable(other)
          : false;

  for (const it of items) {
    if (excluded.includes(it.id) || !collidesWith(it.type)) continue;
    if (obbIntersectsOBB(obb, obbFromPose(it, ITEM_DIMS[it.type]), PENETRATION_EPS)) return false;
  }

  return true;
}
