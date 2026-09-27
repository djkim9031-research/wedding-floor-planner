/** Photometric exposure shared by every tier.
 * Scene values are luminance (cd/m²). Saturation-based exposure maps
 * Lmax = 1.2 · 2^EV100 cd/m² (ISO 100, q = 0.65) to 1.0 before AgX, so
 * scale = 1 / (1.2 · 2^EV100). Blender stores radiance as luminance/683, so
 * its film exposure is log2(683/1.2) − EV100. */

export const exposureScale = (ev100: number): number => 1 / (1.2 * 2 ** ev100);

export const blenderFilmExposure = (ev100: number, evComp: number): number =>
  Math.log2(683 / 1.2) - ev100 + evComp;

/** EV100 that maps an average scene luminance to middle grey. */
export const ev100FromAvgLuminance = (avgCdM2: number): number => Math.log2((Math.max(avgCdM2, 1e-6) * 100) / 12.5);

/** Linear sRGB/Rec.709 color of a blackbody-ish CCT (Kelvin), max component 1.
 * Tanner Helland fit — plenty for lamp tints. */
export function cctToLinear(k: number): [number, number, number] {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = (c: number) => {
    const s = Math.min(Math.max(c, 0), 255) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const out: [number, number, number] = [lin(r), lin(g), lin(b)];
  const m = Math.max(...out);
  return [out[0] / m, out[1] / m, out[2] / m];
}
