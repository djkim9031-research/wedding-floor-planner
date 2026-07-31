import { ITEM_DIMS, TABLE_TOPS, isTable } from '../constants';
import { tableClusters } from '../core/clusters';
import { DEG, dist2, obbFromPose, obbIntersectsOBB, rot, unrot } from '../core/geometry';
import type { DrapeReport, DrapeSide, PlacedItem, Pose } from '../types';
import { CORNER_EXCLUDE, FLOOR_EPS, type ClothType } from './constants';
import { distToUnion2D, topAt, type Colliders } from './colliders';
import type { ClothGrid } from './particles';

// ---------------------------------------------------------------------------
// Formatting (quarter-inch buckets, wedding-stationery voice)
// ---------------------------------------------------------------------------

function fmtQ(n: number): string {
  const q = Math.round(n * 4) / 4;
  const whole = Math.floor(q + 1e-6);
  const frac = Math.round((q - whole) * 4);
  const glyph = frac === 1 ? '¼' : frac === 2 ? '½' : frac === 3 ? '¾' : '';
  if (whole === 0 && glyph) return `${glyph}"`;
  return `${whole}${glyph}"`;
}

function sideText(touching: boolean, hasHang: boolean, drop: number, above: number, pool: number): string {
  if (!hasHang) return 'ends on the tabletop';
  if (touching) {
    return pool > 0.125 ? `floor-length, pools ~${fmtQ(pool)}` : 'floor-length';
  }
  return `drops ${fmtQ(drop)}, ${fmtQ(above)} above floor`;
}

/** Compass label for a cloth-local outward normal rotated into the world.
 * World: +x east, +z south, so north points along -z. */
function compassLabel(nlx: number, nlz: number, yawRad: number): string {
  const n = rot(nlx, nlz, yawRad);
  const dots = [-n.z, n.x, n.z, -n.x]; // N E S W
  let best = 0;
  for (let k = 1; k < 4; k++) if (dots[k] > dots[best]) best = k;
  return `${['north', 'east', 'south', 'west'][best]} side`;
}

function percentile95(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Block topology
// ---------------------------------------------------------------------------

function overlappedTables(pose: Pose, w: number, d: number, tables: PlacedItem[]): PlacedItem[] {
  const clothObb = obbFromPose(pose, { w, d });
  return tables.filter(
    (t) => isTable(t.type) && obbIntersectsOBB(clothObb, obbFromPose(t, ITEM_DIMS[t.type]), 0)
  );
}

/** Clusters (over ALL tables, so a connector table doesn't split a block)
 * that carry at least one table under the cloth. */
function clustersUnderCloth(overlapped: PlacedItem[], allTables: PlacedItem[]): PlacedItem[][] {
  const ids = new Set(overlapped.map((t) => t.id));
  return tableClusters(allTables).filter((c) => c.some((t) => ids.has(t.id)));
}

// ---------------------------------------------------------------------------
// Settled measurement — the grid is inextensible, so rest-length counting
// along rows/cols is an exact tape measure of the hang.
// ---------------------------------------------------------------------------

interface SideWalk {
  nlx: number; // cloth-local outward normal
  nlz: number;
  lineCount: number;
  kMax: number; // steps from the cloth edge to the far edge
  step: number; // rest spacing along the walk
  alongStep: number; // spacing between adjacent lines (corner exclusion)
  idx(line: number, k: number): number; // k = 0 at the cloth edge, growing inward
}

export function measureDrape(grid: ClothGrid, pose: Pose, col: Colliders): DrapeReport {
  const { nx, nz, sx, sz, pos } = grid;
  const overlapped = overlappedTables(pose, grid.w, grid.d, col.tables);
  if (overlapped.length === 0) {
    return { sides: [], onFloorOnly: true, bridgesBlocks: false };
  }
  const bridgesBlocks = clustersUnderCloth(overlapped, col.tables).length >= 2;
  const yawRad = pose.yawDeg * DEG;

  const walks: SideWalk[] = [
    { nlx: 0, nlz: -1, lineCount: nx, kMax: nz - 1, step: sz, alongStep: sx, idx: (l, k) => l + k * nx },
    { nlx: 1, nlz: 0, lineCount: nz, kMax: nx - 1, step: sx, alongStep: sz, idx: (l, k) => nx - 1 - k + l * nx },
    { nlx: 0, nlz: 1, lineCount: nx, kMax: nz - 1, step: sz, alongStep: sx, idx: (l, k) => l + (nz - 1 - k) * nx },
    { nlx: -1, nlz: 0, lineCount: nz, kMax: nx - 1, step: sx, alongStep: sz, idx: (l, k) => k + l * nx },
  ];

  const sides: DrapeSide[] = [];
  for (const w of walks) {
    const Ls: number[] = [];
    const lineMinYs: number[] = [];
    const floorDists: number[] = [];
    const lineTops: number[] = [];

    for (let line = 0; line < w.lineCount; line++) {
      const fromEnd = (w.lineCount - 1 - line) * w.alongStep;
      if (line * w.alongStep < CORNER_EXCLUDE || fromEnd < CORNER_EXCLUDE) continue;
      // first particle (walking inward from the cloth edge) resting ON the
      // tabletop — the 2D test alone would catch fabric curled under the rim
      let exit = -1;
      let exitTop = 0;
      for (let k = 0; k <= w.kMax; k++) {
        const i3 = w.idx(line, k) * 3;
        const top = topAt(col, pos[i3], pos[i3 + 2]);
        if (top > 0 && pos[i3 + 1] > top - 1) {
          exit = k;
          exitTop = top;
          break;
        }
      }
      if (exit < 0) continue; // line never touches a tabletop
      Ls.push(Math.max(0, (exit - 0.5) * w.step));
      lineTops.push(exitTop);
      let lmin = Infinity;
      for (let k = 0; k < exit; k++) {
        const i3 = w.idx(line, k) * 3;
        const y = pos[i3 + 1];
        if (y < lmin) lmin = y;
        if (y <= FLOOR_EPS) {
          floorDists.push(distToUnion2D(col, pos[i3], pos[i3 + 2]));
        }
      }
      if (lmin < Infinity) lineMinYs.push(lmin);
    }
    if (Ls.length === 0) continue;

    const L = median(Ls);
    const sideTop = median(lineTops);
    const hasHang = lineMinYs.length > 0;
    // median line = the side's typical hem; corner spill shouldn't relabel it
    const minY = hasHang ? median(lineMinYs) : Infinity;
    const touching = hasHang && minY <= FLOOR_EPS;
    const drop = !hasHang ? 0 : touching ? sideTop : Math.min(sideTop, Math.max(0, sideTop - minY));
    const above = !hasHang || touching ? null : r2(minY);
    const pool = touching ? r2(Math.max(0, L - sideTop)) : null;
    const spread = touching && floorDists.length ? r2(percentile95(floorDists)) : null;
    sides.push({
      label: compassLabel(w.nlx, w.nlz, yawRad),
      dropIn: r2(drop),
      aboveFloorIn: above,
      poolIn: pool,
      poolSpreadIn: spread,
      text: sideText(touching, hasHang, drop, minY, pool ?? 0),
    });
  }

  return { sides, onFloorOnly: false, bridgesBlocks };
}

// ---------------------------------------------------------------------------
// Analytic pre-placement prediction (no sim): flat cloth rect vs. the bounds
// of the table block under it, measured in the cloth's frame.
// ---------------------------------------------------------------------------

export function predictDrape(type: ClothType, pose: Pose, tables: PlacedItem[]): DrapeReport {
  const dims = ITEM_DIMS[type];
  const w = dims.w;
  const d = dims.d;
  const onlyTables = tables.filter((t) => isTable(t.type));
  const overlapped = overlappedTables(pose, w, d, onlyTables);
  if (overlapped.length === 0) {
    return { sides: [], onFloorOnly: true, bridgesBlocks: false };
  }
  const clusters = clustersUnderCloth(overlapped, onlyTables);
  const bridgesBlocks = clusters.length >= 2;

  // primary block: the cluster whose nearest table is closest to the cloth center
  let primary = clusters[0];
  let bestD = Infinity;
  for (const c of clusters) {
    for (const t of c) {
      const dd = dist2({ x: t.x, z: t.z }, { x: pose.x, z: pose.z });
      if (dd < bestD) {
        bestD = dd;
        primary = c;
      }
    }
  }

  // block AABB in the cloth frame, clipped to the cloth rect
  const yawRad = pose.yawDeg * DEG;
  let blockTop = 0;
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const t of primary) {
    if (isTable(t.type) && TABLE_TOPS[t.type] > blockTop) blockTop = TABLE_TOPS[t.type];
    const o = obbFromPose(t, ITEM_DIMS[t.type]);
    for (const [sxn, szn] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]) {
      const cw = rot(sxn * o.hw, szn * o.hd, o.yawRad);
      const local = unrot(t.x + cw.x - pose.x, t.z + cw.z - pose.z, yawRad);
      if (local.x < bx0) bx0 = local.x;
      if (local.x > bx1) bx1 = local.x;
      if (local.z < bz0) bz0 = local.z;
      if (local.z > bz1) bz1 = local.z;
    }
  }
  bx0 = Math.max(bx0, -w / 2);
  bx1 = Math.min(bx1, w / 2);
  bz0 = Math.max(bz0, -d / 2);
  bz1 = Math.min(bz1, d / 2);

  const mk = (nlx: number, nlz: number, overhang: number): DrapeSide => {
    const oh = Math.max(0, overhang);
    const touching = oh >= blockTop;
    const drop = Math.min(oh, blockTop);
    const above = touching ? null : r2(blockTop - oh);
    const pool = touching ? r2(oh - blockTop) : null;
    return {
      label: compassLabel(nlx, nlz, yawRad),
      dropIn: r2(drop),
      aboveFloorIn: above,
      poolIn: pool,
      poolSpreadIn: pool !== null ? r2(pool * 0.6) : null, // rough fold-up guess
      text: sideText(touching, oh > 0, drop, above ?? 0, pool ?? 0),
    };
  };

  return {
    sides: [
      mk(0, -1, bz0 + d / 2),
      mk(1, 0, w / 2 - bx1),
      mk(0, 1, d / 2 - bz1),
      mk(-1, 0, bx0 + w / 2),
    ],
    onFloorOnly: false,
    bridgesBlocks,
  };
}
