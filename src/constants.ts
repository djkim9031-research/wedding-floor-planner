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

/** Zones where items may be placed: the room, and the Tree Deck (an item
 * must fit fully inside one zone — nothing halfway through the glass wall). */
export const PLACEMENT_AREAS: Vec2[][] = [ROOM_POLYGON, DECK_POLY];

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
    { x: 445, z: 2280 },
    { x: 100, z: 2280 },
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
  tableC: { w: 48, d: 30 }, // custom oak — mutable via setCustomTableDims
  chair: { w: 20, d: 17 },
  clothA: { w: 108, d: 156 },
  clothB: { w: 104, d: 144 },
  clothC: { w: 120, d: 120 }, // custom linen — mutable via setCustomClothDims
  lantern18: { w: 9, d: 9 },
  lantern24: { w: 11, d: 11 },
  lantern30: { w: 12, d: 12 },
  lantern36: { w: 14, d: 14 },
  hedge: { w: 48, d: 10 },
  screen: { w: 48, d: 21 },
  setting: { w: 16, d: 12 },
  figureW: { w: 16, d: 11 },
  figureM: { w: 18, d: 12 },
};

export const ITEM_LABELS: Record<ItemType, string> = {
  table: 'Oak Table',
  tableSq: 'Square Oak Table',
  tableQ: 'QCC Table',
  tableC: 'Custom Oak Table',
  chair: 'Oak Bistro Chair',
  clothA: 'Rental Linen',
  clothB: 'C&B Linen',
  clothC: 'Custom Linen',
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
export const isCloth = (t: ItemType): boolean => t === 'clothA' || t === 'clothB' || t === 'clothC';

/** The custom linen's current default size (user-set, persisted). */
export function setCustomClothDims(w: number, d: number): void {
  ITEM_DIMS.clothC = { w, d };
  try {
    localStorage.setItem('wp:clothC', JSON.stringify({ w, d }));
  } catch {
    /* ignore */
  }
}
try {
  const saved = localStorage.getItem('wp:clothC');
  if (saved) {
    const { w, d } = JSON.parse(saved) as { w: number; d: number };
    if (Number.isFinite(w) && Number.isFinite(d)) ITEM_DIMS.clothC = { w, d };
  }
} catch {
  /* ignore */
}

export type LanternType = 'lantern18' | 'lantern24' | 'lantern30' | 'lantern36';
/** free-standing privacy pieces: solid, they block sunlight.
 * Bright rentals: Artificial Hedge 48×10×96 (10" black planter base);
 * Ivory Sausalito Screen 48×21×90 (walnut caster base, fabric panel). */
export const isBarrier = (t: ItemType): boolean => t === 'hedge' || t === 'screen';
export const HEDGE_H = 96;
export const SCREEN_H = 90;
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

export const TABLE_TYPES = ['table', 'tableSq', 'tableQ', 'tableC'] as const;
export type TableType = (typeof TABLE_TYPES)[number];
export const isTable = (t: ItemType): t is TableType =>
  (TABLE_TYPES as readonly string[]).includes(t); // derived — new table types can't be missed again

/** Tabletop heights differ per table (QCC is 1" taller). */
export const TABLE_TOPS: Record<TableType, number> = {
  table: 29.5,
  tableSq: 29.5,
  tableQ: 30.5,
  tableC: 30, // mutable via setCustomTableDims
};
export const TABLE_TOP_MAX = 30.5;
export const TABLE_TOP_T = 1.5; // rendered top slab thickness

/** The custom oak table's current default size (user-set, persisted). */
export function setCustomTableDims(w: number, d: number, h: number): void {
  ITEM_DIMS.tableC = { w, d };
  TABLE_TOPS.tableC = h;
  try {
    localStorage.setItem('wp:tableC', JSON.stringify({ w, d, h }));
  } catch {
    /* ignore */
  }
}
try {
  const savedT = localStorage.getItem('wp:tableC');
  if (savedT) {
    const { w, d, h } = JSON.parse(savedT) as { w: number; d: number; h: number };
    if (Number.isFinite(w) && Number.isFinite(d) && Number.isFinite(h)) {
      ITEM_DIMS.tableC = { w, d };
      TABLE_TOPS.tableC = h;
    }
  }
} catch {
  /* ignore */
}

/** Effective footprint/height for an item (custom pieces carry a stamp). */
export function itemDims(it: { type: ItemType; dims?: { w: number; d: number; h?: number } }): {
  w: number;
  d: number;
} {
  return it.dims ?? ITEM_DIMS[it.type];
}
export function itemTop(it: { type: ItemType; dims?: { w: number; d: number; h?: number } }): number {
  if (!isTable(it.type)) return 0;
  return it.dims?.h ?? TABLE_TOPS[it.type];
}


// Oak Bistro Chair: 20"L × 17"D × 35"H. Two fit between the oak table's legs
// (47.5 − 2×2.5 = 42.5 ⇒ ≤21.25" wide); seat clears the 29.5" top by ~11.5".
export const CHAIR_SEAT_H = TABLE_TOPS.table - 11.5; // 18"
export const CHAIR_BACK_H = 35; // overall height
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
  linenC: 0xf5f2e8, // custom — bright white linen
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
    // the couple's saved reception layout — three linened table sets plus the
    // ceremony chairs, lantern, and figures, exactly as arranged on the floor
    name: 'Wedding layout',
    items: [
      { type: 'lantern18', x: 329.34528906642606, z: -204.2944483572774, yawDeg: 0 },
      { type: 'figureM', x: 196.52571775852886, z: -187.5658261457075, yawDeg: 0 },
      { type: 'figureW', x: 227.99038969355976, z: -185.0639703700082, yawDeg: 0 },
      { type: 'chair', x: 208.17359427927747, z: -60.73037620267428, yawDeg: 180 },
      { type: 'chair', x: 172.49763451044694, z: -59.218600130674474, yawDeg: 180 },
      { type: 'chair', x: 245.53808518733345, z: -57.34875958515319, yawDeg: 180 },
      { type: 'chair', x: 279.2561041997567, z: -56.8473731191945, yawDeg: 180 },
      { type: 'chair', x: 308.25103766058237, z: -78.12364566358359, yawDeg: 225 },
      { type: 'chair', x: 140.01896607878814, z: -84.52872308639104, yawDeg: 135 },
      { type: 'chair', x: 119.3032851063646, z: -113.58367258649724, yawDeg: 125 },
      { type: 'tableQ', x: 488.3024645788308, z: 219.9400689521737, yawDeg: 90, set: 'Table Set 2' },
      { type: 'clothC', x: 488.3024645788308, z: 219.9400689521737, yawDeg: 90, dims: { w: 102, d: 60 }, set: 'Table Set 2' },
      { type: 'tableQ', x: 136.00914094853152, z: 482.58569277880554, yawDeg: 90, set: 'Table Set 3' },
      { type: 'clothC', x: 136.00914094853152, z: 482.58569277880554, yawDeg: 90, dims: { w: 102, d: 60 }, set: 'Table Set 3' },
      { type: 'table', x: 223.28677816578266, z: 95.5814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'table', x: 270.78677816578266, z: 95.5814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'table', x: 223.28677816578266, z: 127.0814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'table', x: 270.78677816578266, z: 127.0814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'table', x: 318.28677816578266, z: 95.5814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'table', x: 318.28677816578266, z: 127.0814147994799, yawDeg: 0, set: 'Table Set 1' },
      { type: 'clothC', x: 270.78677816578266, z: 111.33141479947989, yawDeg: 0, dims: { w: 200, d: 120 }, set: 'Table Set 1' },
      { type: 'chair', x: 255.76119443857152, z: 69.20542745211704, yawDeg: 0, set: 'Table Set 1' },
      { type: 'chair', x: 280.46103462572677, z: 70.23115454099435, yawDeg: 0, set: 'Table Set 1' },
      { type: 'chair', x: 188.0830891235752, z: 97.67198605415963, yawDeg: 90, set: 'Table Set 1' },
      { type: 'chair', x: 188.3712171993445, z: 122.66155391472093, yawDeg: 90, set: 'Table Set 1' },
      { type: 'chair', x: 351.3474343769902, z: 100.27980915899259, yawDeg: 270, set: 'Table Set 1' },
      { type: 'chair', x: 350.9500735156043, z: 125.28393353461696, yawDeg: 270, set: 'Table Set 1' },
      { type: 'chair', x: 284.1929226478649, z: 152.83783805045692, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 257.94255561983476, z: 152.87399418147504, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 232.59725743392056, z: 152.40921443979738, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 310.6645847911573, z: 152.61729784952564, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 254.22898566745533, z: 86.92546750083052, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 278.1738336128281, z: 86.80262248515506, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 206.14320416965901, z: 97.4557319041776, yawDeg: 270, set: 'Table Set 1' },
      { type: 'setting', x: 205.83128516501858, z: 120.73429109630668, yawDeg: 270, set: 'Table Set 1' },
      { type: 'setting', x: 236.07900714016017, z: 133.9280984690826, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 260.110846587206, z: 134.80361347364448, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 285.7522692100625, z: 134.67302953212612, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 311.31178259814027, z: 135.07644006388296, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 334.33405182383996, z: 97.59042323930909, yawDeg: 90, set: 'Table Set 1' },
      { type: 'setting', x: 334.2430182238856, z: 122.33079533094788, yawDeg: 90, set: 'Table Set 1' },
    ],
  },
];
