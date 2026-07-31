import { COLUMNS, ITEM_DIMS, PENETRATION_EPS, ROOM_POLYGON, isBarrier, isFigure, isTable } from '../constants';
import type { ItemType, PlacedItem, Pose } from '../types';
import { aabbToOBB, obbFromPose, obbIntersectsOBB, pointInPolygon, segmentIntersectsOBB, obbCorners } from './geometry';

/**
 * Placement rules:
 *  - every item must sit fully inside the room polygon (no wall crossings)
 *  - nothing overlaps the two structural columns (except figures, which are
 *    visual aids only)
 *  - tables must not interpenetrate other tables (flush contact is fine)
 *  - chairs must not interpenetrate other chairs, but may tuck under tables
 *  - cloths may overlap tables, chairs, cloths, and figures freely
 */
export function isPoseValid(type: ItemType, pose: Pose, items: PlacedItem[], selfId?: string): boolean {
  const obb = obbFromPose(pose, ITEM_DIMS[type]);

  const corners = obbCorners(obb);
  for (const c of corners) {
    if (!pointInPolygon(c, ROOM_POLYGON)) return false;
  }
  for (let i = 0; i < ROOM_POLYGON.length; i++) {
    const a = ROOM_POLYGON[i];
    const b = ROOM_POLYGON[(i + 1) % ROOM_POLYGON.length];
    if (segmentIntersectsOBB(a, b, obb)) return false;
  }

  if (isFigure(type)) return true;

  for (const col of COLUMNS) {
    if (obbIntersectsOBB(obb, aabbToOBB(col.cx, col.cz, col.size, col.size), PENETRATION_EPS)) {
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
    if (it.id === selfId || !collidesWith(it.type)) continue;
    if (obbIntersectsOBB(obb, obbFromPose(it, ITEM_DIMS[it.type]), PENETRATION_EPS)) return false;
  }

  return true;
}
