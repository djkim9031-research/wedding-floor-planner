import { LEG_SIZE, COLORS, ITEM_DIMS } from '../constants';

// ---------------------------------------------------------------------------
// Cloth simulation tuning (all lengths in inches, time in seconds)
// ---------------------------------------------------------------------------

export const DT = 1 / 60;
export const SUBSTEPS = 4;
/** Accumulator clamp: never simulate more than this many fixed frames per tick. */
export const MAX_CATCHUP_FRAMES = 3;

export const GRAVITY = 386.09; // in/s²

// Damping ramps up late in the settle so the drop stays lively but converges.
export const DAMP_LO = 1.0; // s⁻¹
export const DAMP_HI = 6.0;
export const DAMP_T0 = 1.5; // sim-time where the ramp starts
export const DAMP_T1 = 2.5;

/** Per-substep speed clamp: VMAX = VMAX_FACTOR * spacing / h. */
export const VMAX_FACTOR = 0.4;

// Constraint groups: iteration counts and XPBD compliance (m/N equivalent).
export const STRUCT_ITERS = 2;
export const SHEAR_ITERS = 1;
export const BEND_ITERS = 1;
export const COMPLIANCE_STRUCT = 0;
export const COMPLIANCE_SHEAR = 2e-4;
export const COMPLIANCE_BEND = 2e-2;

// Grid resolution
export const SPACING_FINE = 2.5;
export const SPACING_COARSE = 3.0;

// Collision
export const PARTICLE_R = 0.25;
export const WELD_EPS = 0.125; // footprint inflation: seals snapped-table seams
export const SLAB_T = 2;
export const LEG_R = 1.5;
export const LEG_INSET = LEG_SIZE / 2;
export const LEG_CULL_XZ = 6;

export const FRICTION = {
  table: { s: 0.5, k: 0.3 },
  floor: { s: 0.6, k: 0.4 },
  leg: { s: 0.4, k: 0.3 },
};

// Self-collision
export const SELF_R_FACTOR = 0.55; // R_self = factor * spacing
export const SELF_PAIR_CAP = 0.3; // max pushout per pair per frame

// Settle / sleep
export const SLEEP_AVG_DISP = 0.01;
export const SLEEP_MAX_DISP = 0.05;
export const SLEEP_FRAMES = 15;
export const HARD_CAP_S = 3.0;
/** invalidate() restarts the clock here so the damping ramp arrives quickly. */
export const INVALIDATE_CLOCK_S = 1.0;

// Placement drop
export const DROP_HEIGHT = 1.5;
export const NOISE_Y = 0.12;
export const NOISE_XZ = 0.08;

// Measurement
export const FLOOR_EPS = 0.6; // particle this close to the floor counts as touching
export const CORNER_EXCLUDE = 3; // skip measurement lines this close to cloth corners
export const INVALIDATE_MARGIN = 6; // cloth AABB inflation for table-change fan-out

export type ClothType = 'clothA' | 'clothB';

export interface ClothSpec {
  type: ClothType;
  w: number;
  d: number;
  color: number;
  spacing: number;
  coarse: boolean;
}

/** Coarse tier: touch devices / small screens get 3" grid, no self-collision,
 * and render the sim mesh directly (no subdivision). */
export function isCoarseTier(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return Math.min(window.innerWidth, window.innerHeight) < 700;
}

export function makeClothSpec(type: ClothType, coarse = isCoarseTier()): ClothSpec {
  const dims = ITEM_DIMS[type];
  return {
    type,
    w: dims.w,
    d: dims.d,
    color: type === 'clothA' ? COLORS.linenA : COLORS.linenB,
    spacing: coarse ? SPACING_COARSE : SPACING_FINE,
    coarse,
  };
}
