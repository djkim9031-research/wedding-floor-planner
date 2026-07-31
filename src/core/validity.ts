import { COLUMNS, ITEM_DIMS, PENETRATION_EPS, ROOM_POLYGON, isTable } from '../constants';
import type { ItemType, PlacedItem, Pose } from '../types';
import { aabbToOBB, obbFromPose, obbIntersectsOBB, pointInPolygon, segmentIntersectsOBB, obbCorners } from './geometry';

/**
 * Placement rules:
 *  - every item must sit fully inside the room polygon (no wall crossings)
 *  - nothing overlaps the two structural columns (except the figure, which is
 *    a visual aid only)
 *  - tables must not interpenetrate other tables (flush contact is fine)
 *  - cloths may overlap tables, cloths, and the figure freely
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

  if (type === 'figure') return true;

  for (const col of COLUMNS) {
    if (obbIntersectsOBB(obb, aabbToOBB(col.cx, col.cz, col.size, col.size), PENETRATION_EPS)) {
      return false;
    }
  }

  if (isTable(type)) {
    for (const it of items) {
      if (it.id === selfId || !isTable(it.type)) continue;
      if (obbIntersectsOBB(obb, obbFromPose(it, ITEM_DIMS[it.type]), PENETRATION_EPS)) return false;
    }
  }

  return true;
}
