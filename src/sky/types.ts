/** Physical sky contract — one source of truth for the raster view, the
 * in-app path tracer and the Blender export. Luminance in cd/m², sun/moon
 * illuminance in lux, directions in the three.js model frame (Y up), pointing
 * FROM the scene TOWARD the body. */

export type Vec3 = [number, number, number];

export interface SkyInput {
  /** false = showcase preset (fixed afternoon) */
  enabled: boolean;
  /** YYYY-MM-DD, venue-local */
  date: string;
  /** minutes after local midnight */
  minutes: number;
  /** 0..100 overcast */
  cloudPct: number;
  /** exposure compensation, EV */
  evComp: number;
  /** meter exposure from the scene instead of the sky preset */
  autoEV: boolean;
}

export type SkyPhase = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

/** Equirect float image, RGBA, rows bottom-up (row 0 = nadir), three.js
 * equirect convention u = atan2(d.z, d.x)/2π + 0.5, v = asin(d.y)/π + 0.5. */
export interface EquirectImage {
  w: number;
  h: number;
  data: Float32Array;
}

export interface SkyState {
  input: SkyInput;
  phase: SkyPhase;
  sun: {
    altDeg: number;
    azTrueDeg: number;
    azModelDeg: number;
    dir: Vec3;
    /** 0..1 — the western ridge hides the disc before geometric sunset */
    ridgeVisibility: number;
    /** direct normal illuminance at the ground, lux (0 below horizon/ridge) */
    illuminanceLux: number;
    colorLinear: Vec3;
    angularDiameterDeg: number;
  };
  moon: {
    altDeg: number;
    azModelDeg: number;
    dir: Vec3;
    fraction: number;
    brightLimbDeg: number;
    illuminanceLux: number;
    colorLinear: Vec3;
  };
  /** sky radiance without sun/moon discs (lighting), 512×256, cd/m².
   * The physical model recycles its image buffers every other update: copy
   * `data` if you need it after the next sky change. */
  env: EquirectImage;
  /** sky as seen by the camera: env (2× upsampled) + stars + moon disc,
   * 1024×512, cd/m² (same buffer recycling as env) */
  bg: EquirectImage;
  /** illuminance on a horizontal plane from the sky dome alone, lux */
  skyHorizontalLux: number;
  /** exposure the camera uses (EV100), compensation already applied:
   * ev100 = metered − evComp (so +1 EV comp brightens) */
  ev100: number;
  /** bumps whenever any field changes */
  version: number;
}
