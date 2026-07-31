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

// Tree Deck (north of the room, flush with interior floor) — bbox of the
// true outline below
export const DECK = { x0: -178, x1: 737, z0: -498, z1: 145 };

/** Tree Deck outline traced from the venue plan (clockwise, closes along the
 * building face at z=0; the tail past z=0 is the strip wrapping the room's
 * east storefront). */
export const DECK_POLY: Vec2[] = [
  { x: -178, z: 0 },
  { x: -178, z: -290 },
  { x: 27, z: -498 },
  { x: 548, z: -498 },
  { x: 737, z: -290 },
  { x: 737, z: 145 },
  { x: 591, z: 145 },
  { x: 551, z: 75 },
  { x: 551, z: 0 },
];

/** The single oak rising through the central deck (per the venue photos). */
export const DECK_TREES: Vec2[] = [{ x: 287, z: -190 }];

/** Where the stand-here camera may walk: room, deck, hallways, bathrooms,
 * and the entry breezeway. */
export const WALK_AREAS: Vec2[][] = [
  ROOM_POLYGON,
  DECK_POLY,
  [
    // middle + west hallway with the west bathroom suite
    { x: -597, z: 599 },
    { x: 174, z: 599 },
    { x: 174, z: 659 },
    { x: -597, z: 659 },
  ],
  [
    { x: -597, z: 421 },
    { x: -455, z: 421 },
    { x: -455, z: 599 },
    { x: -597, z: 599 },
  ],
  [
    // east hallway + east bathroom
    { x: 377, z: 605 },
    { x: 694, z: 605 },
    { x: 694, z: 659 },
    { x: 377, z: 659 },
  ],
  [
    { x: 490, z: 509 },
    { x: 694, z: 509 },
    { x: 694, z: 605 },
    { x: 490, z: 605 },
  ],
  [
    // entry breezeway + drop-off court
    { x: 100, z: 659 },
    { x: 445, z: 659 },
    { x: 445, z: 2740 },
    { x: 100, z: 2740 },
  ],
];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Footprint at yaw 0: w along x, d along z (inches). */
export const ITEM_DIMS: Record<ItemType, { w: number; d: number }> = {
  table: { w: 47.5, d: 31.5 },
  tableSq: { w: 35.5, d: 35.5 },
  tableQ: { w: 72, d: 36 },
  chair: { w: 20, d: 20 },
  clothA: { w: 108, d: 156 },
  clothB: { w: 104, d: 144 },
  lantern18: { w: 9, d: 9 },
  lantern24: { w: 11, d: 11 },
  lantern30: { w: 12, d: 12 },
  lantern36: { w: 14, d: 14 },
  hedge: { w: 48, d: 14 },
  screen: { w: 66, d: 16 },
  setting: { w: 16, d: 12 },
  figureW: { w: 16, d: 11 },
  figureM: { w: 18, d: 12 },
};

export const ITEM_LABELS: Record<ItemType, string> = {
  table: 'Oak Table',
  tableSq: 'Square Oak Table',
  tableQ: 'QCC Table',
  chair: 'Oak Bistro Chair',
  clothA: 'Rental Linen',
  clothB: 'C&B Linen',
  lantern18: 'Lantern · 18″',
  lantern24: 'Lantern · 24″',
  lantern30: 'Lantern · 30″',
  lantern36: 'Lantern · 36″',
  hedge: 'Artificial Hedge',
  screen: 'Sausalito Screen',
  setting: 'Place Setting',
  figureW: 'Guest · 5′5″',
  figureM: 'Guest · 5′10″',
};

export const isFigure = (t: ItemType): boolean => t === 'figureW' || t === 'figureM';

export type LanternType = 'lantern18' | 'lantern24' | 'lantern30' | 'lantern36';
/** free-standing privacy pieces: solid, they block sunlight */
export const isBarrier = (t: ItemType): boolean => t === 'hedge' || t === 'screen';
export const HEDGE_H = 90;
export const SCREEN_H = 84;
export const isLantern = (t: ItemType): t is LanternType => t.startsWith('lantern');

/** DutchCrafters-style outdoor candle lanterns: square poly frame, open
 * sides, pitched cap. A real candle is ~13 lumens — the point light is tuned
 * to read as a dim, moody pool, not illumination. */
export const LANTERN_SPECS: Record<LanternType, { h: number; colorHex: number; candela: number }> = {
  lantern18: { h: 18, colorHex: 0x1f1f1f, candela: 3.2 },
  lantern24: { h: 24, colorHex: 0x1f1f1f, candela: 4.0 },
  lantern30: { h: 30, colorHex: 0x1f1f1f, candela: 4.8 },
  lantern36: { h: 36, colorHex: 0xf4f1e8, candela: 5.6 },
};
export const FIGURE_HEIGHTS: Record<'figureW' | 'figureM', number> = {
  figureW: 65, // 5'5"
  figureM: 70, // 5'10"
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

// Chair proportions derive from the oak dining table: two chairs must fit
// between its legs along the 47.5" side (47.5 − 2×2.5 = 42.5 ⇒ ≤21.25" wide),
// and the seat clears the 29.5" tabletop by the usual ~11.5".
export const CHAIR_SEAT_H = TABLE_TOPS.table - 11.5; // 18"
export const CHAIR_BACK_H = CHAIR_SEAT_H + 16; // 34" back top
export const LEG_SIZE = 2.5; // square legs, set at the corners
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
