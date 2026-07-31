import { CONTACT_GAP, ITEM_DIMS, isTable } from '../constants';
import type { PlacedItem } from '../types';
import { obbFromPose, obbIntersectsOBB, rot, unrot, type OBB } from './geometry';

function touching(a: PlacedItem, b: PlacedItem): boolean {
  const aDims = ITEM_DIMS[a.type];
  // growing one box by the full gap detects face gaps up to CONTACT_GAP
  const grown: OBB = {
    ...obbFromPose(a, aDims),
    hw: aDims.w / 2 + CONTACT_GAP,
    hd: aDims.d / 2 + CONTACT_GAP,
  };
  return obbIntersectsOBB(grown, obbFromPose(b, ITEM_DIMS[b.type]), 0);
}

/** Connected components of tables in flush/near contact. */
export function tableClusters(items: PlacedItem[]): PlacedItem[][] {
  const tables = items.filter((it) => isTable(it.type));
  const seen = new Set<string>();
  const clusters: PlacedItem[][] = [];
  for (const t of tables) {
    if (seen.has(t.id)) continue;
    const cluster: PlacedItem[] = [];
    const queue = [t];
    seen.add(t.id);
    while (queue.length) {
      const cur = queue.pop()!;
      cluster.push(cur);
      for (const other of tables) {
        if (!seen.has(other.id) && touching(cur, other)) {
          seen.add(other.id);
          queue.push(other);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export interface ClusterBounds {
  cx: number;
  cz: number;
  w: number;
  d: number;
  yawDeg: number;
}

/** Oriented bounds of a cluster, measured in the first table's frame. */
export function clusterBounds(cluster: PlacedItem[]): ClusterBounds {
  const yawDeg = cluster[0].yawDeg;
  const yawRad = (yawDeg * Math.PI) / 180;
  let lo = { x: Infinity, z: Infinity };
  let hi = { x: -Infinity, z: -Infinity };
  for (const t of cluster) {
    const o = obbFromPose(t, ITEM_DIMS[t.type]);
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]) {
      const w = rot(sx * o.hw, sz * o.hd, o.yawRad);
      const local = unrot(t.x + w.x, t.z + w.z, yawRad);
      lo = { x: Math.min(lo.x, local.x), z: Math.min(lo.z, local.z) };
      hi = { x: Math.max(hi.x, local.x), z: Math.max(hi.z, local.z) };
    }
  }
  const centerLocal = { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 };
  const centerWorld = rot(centerLocal.x, centerLocal.z, yawRad);
  return {
    cx: centerWorld.x,
    cz: centerWorld.z,
    w: hi.x - lo.x,
    d: hi.z - lo.z,
    yawDeg,
  };
}
