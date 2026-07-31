export type ItemType = 'table' | 'tableSq' | 'tableQ' | 'clothA' | 'clothB' | 'figure';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose {
  x: number;
  z: number;
  yawDeg: number;
}

export interface PlacedItem extends Pose {
  id: string;
  type: ItemType;
}

export interface SnapResult {
  otherId: string;
  pose: Pose;
  sharedEdge: [Vec2, Vec2];
}

export interface GhostState extends Pose {
  type: ItemType;
  valid: boolean;
  snapped: SnapResult | null;
  /** set when the ghost is a picked-up existing item or a duplicate source */
  sourceId?: string;
  /** touch flow: ghost parked with confirm/cancel buttons */
  parked?: boolean;
}

export interface Settings {
  gridSnap: boolean;
  angleSnap: boolean;
  magnetSnap: boolean;
  showDims: boolean;
}

export type ViewMode = 'orbit' | 'stand';

export interface AppState {
  items: PlacedItem[];
  settings: Settings;
  selectedId: string | null;
  ghost: GhostState | null;
  viewMode: ViewMode;
}

export interface LayoutFile {
  version: 1;
  name?: string;
  savedAt: string;
  items: PlacedItem[];
}

/** One side of a table block's drape measurement. */
export interface DrapeSide {
  /** compass-ish label resolved by the UI, e.g. "long side (north)" */
  label: string;
  /** vertical hang below the tabletop, inches */
  dropIn: number;
  /** clearance to floor, or null when touching */
  aboveFloorIn: number | null;
  /** fabric length lying on the floor, or null when hovering */
  poolIn: number | null;
  /** horizontal spread of the pooled fabric from the table edge */
  poolSpreadIn: number | null;
  /** human-readable summary, e.g. "floor-length, pools ~2¼"" */
  text: string;
}

export interface DrapeReport {
  sides: DrapeSide[];
  onFloorOnly: boolean;
  bridgesBlocks: boolean;
}
