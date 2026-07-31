import type { ItemType, PlacedItem, Vec2 } from './types';

/** World scale: the 3D scene is in meters, all layout math is in inches. */
export const IN = 0.0254;
export const i2m = (n: number) => n * IN;

// ---------------------------------------------------------------------------
// Room geometry — the "Open Space" event room (45'5" x 49'11")
// Origin = NW interior corner. +X east, +Z south, y up, floor at 0.
// Derived from the floor plan at 0.5112 in/px (see plan file).
// ---------------------------------------------------------------------------

export const ROOM_W = 545; // 45'5"
export const ROOM_D = 599; // 49'11"

/** Interior boundary, clockwise from the NW corner. */
export const ROOM_POLYGON: Vec2[] = [
  { x: 0, z: 0 },
  { x: 545, z: 0 },
  { x: 545, z: 419 },
  { x: 484, z: 419 },
  { x: 484, z: 599 },
  { x: 371, z: 599 },
  { x: 371, z: 659 }, // entry vestibule bulge
  { x: 180, z: 659 },
  { x: 180, z: 599 },
  { x: 65, z: 599 },
  { x: 65, z: 419 },
  { x: 0, z: 419 },
];

/** Name of the wall behind polygon edge i (edge i runs vertex i -> i+1). */
export const WALL_NAMES: string[] = [
  'glass wall (deck)',
  'east wall',
  'east alcove',
  'east wall',
  'south wall',
  'vestibule',
  'entry doors',
  'vestibule',
  'south wall',
  'west wall',
  'west alcove',
  'west wall',
];

export interface ColumnDef {
  cx: number;
  cz: number;
  size: number;
  height: number;
}

/** Two interior structural columns carrying the glulam beams. */
export const COLUMNS: ColumnDef[] = [
  { cx: 183, cz: 300, size: 10, height: 102 },
  { cx: 365, cz: 300, size: 10, height: 102 },
];

// Structural grid used by the venue builder (thirds of the room width).
export const BAY_X = [0, 181.7, 363.3, 545];

// Heights (inches)
export const EAVE_Y = 108;
export const RIDGE_Y = 210;
export const RIDGE_X = 272.5;
export const DOOR_HEAD_Y = 84;
export const WINDOW_SILL_Y = 36;
export const STOREFRONT_HEAD_Y = 96;

// Deck (north of the room, flush with interior floor)
export const DECK = { x0: -120, x1: 665, z0: -288, z1: 0 };

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Footprint at yaw 0: w along x, d along z (inches). */
export const ITEM_DIMS: Record<ItemType, { w: number; d: number }> = {
  table: { w: 47.5, d: 31.5 },
  tableSq: { w: 35.5, d: 35.5 },
  tableQ: { w: 72, d: 36 },
  clothA: { w: 108, d: 156 },
  clothB: { w: 104, d: 144 },
  figure: { w: 20, d: 12 },
};

export const ITEM_LABELS: Record<ItemType, string> = {
  table: 'Oak Table',
  tableSq: 'Square Oak Table',
  tableQ: 'QCC Table',
  clothA: 'Rental Linen',
  clothB: 'C&B Linen',
  figure: 'Scale Figure',
};

export const TABLE_TYPES = ['table', 'tableSq', 'tableQ'] as const;
export type TableType = (typeof TABLE_TYPES)[number];
export const isTable = (t: ItemType): t is TableType =>
  t === 'table' || t === 'tableSq' || t === 'tableQ';

/** Tabletop heights differ per table (QCC is 1" taller). */
export const TABLE_TOPS: Record<TableType, number> = {
  table: 29.5,
  tableSq: 29.5,
  tableQ: 30.5,
};
export const TABLE_TOP_MAX = 30.5;
export const TABLE_TOP_T = 1.5; // rendered top slab thickness
export const LEG_SIZE = 2.5; // square legs, set at the corners
export const FIGURE_HEIGHT = 66; // 5'6" scale silhouette
export const EYE_HEIGHT = 60; // stand-here camera height

// ---------------------------------------------------------------------------
// Snapping / validity tolerances (inches / degrees)
// ---------------------------------------------------------------------------

export const SNAP = {
  grid: 1,
  angleDeg: 15,
  fineAngleDeg: 1,
  engage: 4, // magnet engages at gap <= 4"
  release: 6, // and lets go past 6" (hysteresis)
  minEdgeOverlap: 6,
  lateralMagnet: 4,
  normalAlignDeg: 10,
};

/** Tables may sit flush; only treat deeper penetration as a collision. */
export const PENETRATION_EPS = 0.05;

/** Tables within this gap count as one contiguous block (cluster dims + cloth). */
export const CONTACT_GAP = 0.6;

// ---------------------------------------------------------------------------
// Palette / UI colors
// ---------------------------------------------------------------------------

export const COLORS = {
  valid: 0x8a9a7b, // sage
  invalid: 0xb4655a, // brick
  brass: 0xb08d57,
  hover: 0xf5efe2,
  tableOak: 0xc68a4f,
  tableOakEdge: 0xb57a40,
  linenA: 0xf2ebdd, // ivory
  linenB: 0xe4d5bb, // warm oat
};

// ---------------------------------------------------------------------------
// Presets — the two sticky-note layouts (editable to taste)
// ---------------------------------------------------------------------------

export interface PresetDef {
  name: string;
  items: Omit<PlacedItem, 'id'>[];
}

export const PRESETS: PresetDef[] = [
  {
    // 3 tables stacked long-edge-to-long-edge => 47.5" x 94.5" block, C&B linen
    name: 'Crate & Barrel',
    items: [
      { type: 'table', x: 272.5, z: 268.5, yawDeg: 0 },
      { type: 'table', x: 272.5, z: 300, yawDeg: 0 },
      { type: 'table', x: 272.5, z: 331.5, yawDeg: 0 },
      { type: 'clothB', x: 272.5, z: 300, yawDeg: 0 },
    ],
  },
  {
    // 2 tables side by side + 1 perpendicular below center => T, rental linen
    name: 'Rental',
    items: [
      { type: 'table', x: 248.75, z: 280, yawDeg: 0 },
      { type: 'table', x: 296.25, z: 280, yawDeg: 0 },
      { type: 'table', x: 272.5, z: 319.5, yawDeg: 90 },
      { type: 'clothA', x: 272.5, z: 293, yawDeg: 90 },
    ],
  },
];
