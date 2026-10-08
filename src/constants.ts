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

/** Two interior structural posts carrying the glulam beams. Reference photo 05
 * shows slim ~6" square white posts running up to the beams, which sit right
 * under the rafters (beam soffit ≈ 13'8"). */
export const COLUMNS: ColumnDef[] = [
  { cx: 183, cz: 300, size: 6, height: 165 },
  { cx: 365, cz: 300, size: 6, height: 165 },
];

// Structural grid used by the venue builder (thirds of the room width).
export const BAY_X = [0, 181.7, 363.3, 545];

// Heights (inches)
/** Eave of the annex wings and the entry breezeway. */
export const EAVE_Y = 108;
/** Hall wall-top line: where the reed ceiling plane meets the east/west walls.
 * Measured from reference photos 02/05 (rails at 36", window-wall header
 * ≈ 10'–11', rake at the corners ≈ 12'); the ridge stays at RIDGE_Y. */
export const HALL_EAVE_Y = 144;
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

/** Horizontal ellipse (inches, model frame). `rotDeg` turns the local +x
 * axis like an item yaw (positive rotates +x toward −z). */
export interface TrunkFootprint {
  x: number;
  z: number;
  /** semi-axis along the rotated local x */
  rx: number;
  /** semi-axis along the rotated local z */
  rz: number;
  rotDeg: number;
}

/** Where the deck oak stands relative to where its skeleton and crown were
 * first authored (trunk A at 406, −324). The couple placed the tree on the
 * plan: right behind where they stand for the ceremony, trunk B about 7"
 * from them. Everything tied to the tree (crown, litter, critters) follows
 * this offset. */
export const DECK_OAK_MOVE = { x: -218, z: 89 };

/** The deck oak's trunks where they pass through the deck: the scribed board
 * opening around each flared base (the trunk itself sits ~1.25" inside it).
 * Photos 03/04: a strongly leaning main trunk (A, leaning west) and an
 * upright companion (B) behind it off one root crown, plus a massive upright
 * stem (C) just east. Nothing may be placed over an opening. */
export const DECK_TRUNKS: TrunkFootprint[] = [
  { x: 406, z: -324, rx: 13.5, rz: 10.5, rotDeg: 4 }, // A — leaning main trunk
  { x: 432, z: -364, rx: 9.5, rz: 9.5, rotDeg: 0 }, // B — upright companion
  { x: 452, z: -334, rx: 11.5, rz: 11, rotDeg: -10 }, // C — upright east stem
].map((t) => ({ ...t, x: t.x + DECK_OAK_MOVE.x, z: t.z + DECK_OAK_MOVE.z }));

/** Bronze deck planters (fixed scenery, each with a shrub): centre points.
 * The pot is a 26" tapered square, the shrub spreads ~18" around the centre. */
export const DECK_PLANTER_SPOTS: [number, number][] = [
  [-70, -36],
  [150, -420],
  [620, -40],
  [700, 110],
];
export const DECK_PLANTER_REACH = 18;

/** The covered entry breezeway's upper paver level, from the vestibule doors
 * south to the steps down to the court (the walk the guests arrive on). */
export const ENTRY_WALK: Vec2[] = [
  { x: 76, z: 662 },
  { x: 469, z: 662 },
  { x: 469, z: 1688 },
  { x: 76, z: 1688 },
];

/** The breezeway's 8" posts: two rows at x 150 / 395, every 144" from z 730. */
export const BREEZEWAY_POSTS: Vec2[] = [150, 395].flatMap((x) =>
  Array.from({ length: 8 }, (_, k) => ({ x, z: 730 + 144 * k })),
);
export const BREEZEWAY_POST_SIZE = 8;

/** Zones where items may be placed: the room, the Tree Deck and the entry
 * walk (an item must fit fully inside one zone — nothing halfway through the
 * glass wall). */
export const PLACEMENT_AREAS: Vec2[][] = [ROOM_POLYGON, DECK_POLY, ENTRY_WALK];

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
  tableCoffee: { w: 12, d: 12 }, // small charcoal slatted table; four push together (couple's photos)
  loungeSofa: { w: 84, d: 36 }, // three-seat teak deep-seating sofa
  loungeChair: { w: 32, d: 34 }, // teak deep-seating club chair
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
  planterHarithS: { w: 12.4, d: 12.4 },
  planterCodyM: { w: 11.81, d: 11.81 },
  planterJesslynXXS: { w: 12.99, d: 12.99 },
  planterCodyL: { w: 14.57, d: 14.57 },
  planterHarithM: { w: 16.5, d: 16.5 },
  plantFern: { w: 10.5, d: 10.5 }, // opening of Harith S
  plantBoxwood: { w: 10, d: 10 }, // opening of Cody M
  plantSnake: { w: 11, d: 11 }, // opening of Jesslyn XXS
  plantGrass: { w: 12.4, d: 12.4 }, // opening of Cody L
  plantOlive: { w: 14, d: 14 }, // opening of Harith M
  plantMossTree: { w: 10, d: 10 }, // fits every pot's opening
  plantRosemary: { w: 10, d: 10 }, // fits every pot's opening
};

export const ITEM_LABELS: Record<ItemType, string> = {
  table: 'Oak Table',
  tableSq: 'Square Oak Table',
  tableQ: 'QCC Table',
  tableC: 'Custom Oak Table',
  tableCoffee: 'Slatted Coffee Table',
  loungeSofa: 'Lounge Sofa',
  loungeChair: 'Lounge Chair',
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
  planterHarithS: 'Harith S Planter',
  planterCodyM: 'Cody M Planter',
  planterJesslynXXS: 'Jesslyn XXS Planter',
  planterCodyL: 'Cody L Planter',
  planterHarithM: 'Harith M Planter',
  plantFern: 'Boston Fern',
  plantBoxwood: 'Boxwood Ball',
  plantSnake: 'Snake Plant',
  plantGrass: 'Fountain Grass',
  plantOlive: 'Olive Tree',
  plantMossTree: 'Fern Moss Tree',
  plantRosemary: 'Coast Rosemary',
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
/** Deep-seating lounge pieces (solid: they bump tables, chairs and each other). */
export const isLounge = (t: ItemType): boolean => t === 'loungeSofa' || t === 'loungeChair';
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

export const PLANTER_TYPES = [
  'planterHarithS',
  'planterCodyM',
  'planterJesslynXXS',
  'planterCodyL',
  'planterHarithM',
] as const;
export type PlanterType = (typeof PLANTER_TYPES)[number];
export const isPlanter = (t: ItemType): t is PlanterType =>
  (PLANTER_TYPES as readonly string[]).includes(t);

export const PLANT_TYPES = [
  'plantFern',
  'plantBoxwood',
  'plantSnake',
  'plantGrass',
  'plantOlive',
  'plantMossTree',
  'plantRosemary',
] as const;
export type PlantType = (typeof PLANT_TYPES)[number];
export const isPlant = (t: ItemType): t is PlantType =>
  (PLANT_TYPES as readonly string[]).includes(t);

/** Pottery Pots "Diorite Grey" fiberstone rounds. openingDia = the soil bowl
 * at the rim; soilDrop = how far the soil surface sits below the rim, so a
 * plant dropped in mounts at h − soilDrop. */
export const PLANTER_SPECS: Record<
  PlanterType,
  { dia: number; h: number; openingDia: number; soilDrop: number; family: 'harith' | 'cody' | 'jesslyn' }
> = {
  planterHarithS: { dia: 12.4, h: 11.02, openingDia: 10.5, soilDrop: 1.5, family: 'harith' },
  planterCodyM: { dia: 11.81, h: 10.63, openingDia: 10, soilDrop: 1.5, family: 'cody' },
  planterJesslynXXS: { dia: 12.99, h: 11.42, openingDia: 11, soilDrop: 1.5, family: 'jesslyn' },
  planterCodyL: { dia: 14.57, h: 12.99, openingDia: 12.4, soilDrop: 1.8, family: 'cody' },
  planterHarithM: { dia: 16.5, h: 15, openingDia: 14, soilDrop: 1.8, family: 'harith' },
};

/** Each plant is sized for one planter (its footprint = that pot's opening),
 * but any plant may be dropped into any planter. h = foliage above the soil. */
export const PLANT_SPECS: Record<PlantType, { planter: PlanterType; h: number }> = {
  plantFern: { planter: 'planterHarithS', h: 20 },
  plantBoxwood: { planter: 'planterCodyM', h: 14 },
  plantSnake: { planter: 'planterJesslynXXS', h: 26 },
  plantGrass: { planter: 'planterCodyL', h: 24 },
  plantOlive: { planter: 'planterHarithM', h: 40 },
  plantMossTree: { planter: 'planterHarithS', h: 58 }, // ~5' weeping tree, fits any pot
  plantRosemary: { planter: 'planterHarithS', h: 48 }, // 4' Westringia, fits any pot
};

export const TABLE_TYPES = ['table', 'tableSq', 'tableQ', 'tableC', 'tableCoffee'] as const;
export type TableType = (typeof TABLE_TYPES)[number];
export const isTable = (t: ItemType): t is TableType =>
  (TABLE_TYPES as readonly string[]).includes(t); // derived — new table types can't be missed again

/** Tabletop heights differ per table (QCC is 1" taller). */
export const TABLE_TOPS: Record<TableType, number> = {
  table: 29.5,
  tableSq: 29.5,
  tableQ: 30.5,
  tableC: 30, // mutable via setCustomTableDims
  tableCoffee: 12, // low lounge height
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
  plantReleaseExtra: 3, // plant→planter center magnet lets go this far past the opening
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
      // ceremony by the north railing (as marked on the plan): the couple
      // faces north with the deck oak right behind them; the guests' arc of
      // 8 chairs faces back toward the couple and the hall, drawn in to 8.5'
      // so the front row clears the NW deck planter (150, −420)
      { type: 'lantern18', x: 331.35, z: -318.29, yawDeg: 0 },
      { type: 'figureM', x: 198.53, z: -301.57, yawDeg: 180 },
      { type: 'figureW', x: 229.99, z: -299.06, yawDeg: 180 },
      { type: 'chair', x: 210.99, z: -400.78, yawDeg: 0 },
      { type: 'chair', x: 182.45, z: -401.99, yawDeg: 0 },
      { type: 'chair', x: 240.88, z: -403.49, yawDeg: 0 },
      { type: 'chair', x: 267.86, z: -403.89, yawDeg: 0 },
      { type: 'chair', x: 291.05, z: -386.87, yawDeg: 315 },
      { type: 'chair', x: 156.47, z: -381.74, yawDeg: 45 },
      { type: 'chair', x: 139.89, z: -358.5, yawDeg: 55 },
      { type: 'chair', x: 309.33, z: -358.5, yawDeg: 305 },
      { type: 'tableQ', x: 488.3024645788308, z: 219.9400689521737, yawDeg: 90, set: 'Table Set 2' },
      { type: 'clothC', x: 488.3024645788308, z: 219.9400689521737, yawDeg: 90, dims: { w: 102, d: 60 }, set: 'Table Set 2' },
      { type: 'tableQ', x: 136.00914094853152, z: 482.58569277880554, yawDeg: 90, set: 'Table Set 3' },
      { type: 'clothC', x: 136.00914094853152, z: 482.58569277880554, yawDeg: 90, dims: { w: 102, d: 60 }, set: 'Table Set 3' },
      // cocktail lounge just outside the entry, to the right (east half of the
      // breezeway walk; the west half stays clear for arriving guests), set up
      // like the couple's photo: four small charcoal tables pushed together
      // 2 × 2 with a hint of a gap (1½", slats alternating like the photo), a
      // sofa each side, three lounge chairs south and two north — 11 seats
      { type: 'tableCoffee', x: 323.25, z: 783.25, yawDeg: 0 },
      { type: 'tableCoffee', x: 336.75, z: 783.25, yawDeg: 90 },
      { type: 'tableCoffee', x: 323.25, z: 796.75, yawDeg: 90 },
      { type: 'tableCoffee', x: 336.75, z: 796.75, yawDeg: 0 },
      { type: 'loungeSofa', x: 268, z: 790, yawDeg: 90 },
      { type: 'loungeSofa', x: 392, z: 790, yawDeg: 270 },
      { type: 'loungeChair', x: 296, z: 850, yawDeg: 180 },
      { type: 'loungeChair', x: 330, z: 850, yawDeg: 180 },
      { type: 'loungeChair', x: 364, z: 850, yawDeg: 180 },
      { type: 'loungeChair', x: 300, z: 730, yawDeg: 0 },
      { type: 'loungeChair', x: 360, z: 730, yawDeg: 0 },
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
      // south side: five seats at 23" (squeezed from four at ~25.5"); the
      // outer covers stop just short of the end guests' glasses and B&B plates
      { type: 'chair', x: 222, z: 152.6, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 245, z: 152.6, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 268, z: 152.6, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 291, z: 152.6, yawDeg: 180, set: 'Table Set 1' },
      { type: 'chair', x: 314, z: 152.6, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 254.22898566745533, z: 86.92546750083052, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 278.1738336128281, z: 86.80262248515506, yawDeg: 180, set: 'Table Set 1' },
      { type: 'setting', x: 206.14320416965901, z: 97.4557319041776, yawDeg: 270, set: 'Table Set 1' },
      { type: 'setting', x: 205.83128516501858, z: 120.73429109630668, yawDeg: 270, set: 'Table Set 1' },
      { type: 'setting', x: 222, z: 134.6, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 245, z: 134.6, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 268, z: 134.6, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 291, z: 134.6, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 314, z: 134.6, yawDeg: 0, set: 'Table Set 1' },
      { type: 'setting', x: 334.33405182383996, z: 97.59042323930909, yawDeg: 90, set: 'Table Set 1' },
      { type: 'setting', x: 334.2430182238856, z: 122.33079533094788, yawDeg: 90, set: 'Table Set 1' },
    ],
  },
];
