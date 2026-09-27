/** Photometric exposure shared by every tier.
 * Scene values are luminance (cd/m²). Saturation-based exposure maps
 * Lmax = 1.2 · 2^EV100 cd/m² (ISO 100, q = 0.65) to 1.0 before AgX, so
 * scale = 1 / (1.2 · 2^EV100). Blender stores radiance as luminance/683, so
 * its film exposure is log2(683/1.2) − EV100.
 *
 * Compensation convention: the EV a camera uses is `metered − evComp`, so
 * +1 EV of compensation brightens the image by one stop. */

export const exposureScale = (ev100: number): number => 1 / (1.2 * 2 ** ev100);

/** Inverse of exposureScale. */
export const ev100FromScale = (scale: number): number => Math.log2(1 / (1.2 * Math.max(scale, 1e-30)));

export const blenderFilmExposure = (ev100: number, evComp: number): number =>
  Math.log2(683 / 1.2) - ev100 + evComp;

/** Reflected-light meter (K = 12.5): EV100 that maps an average scene
 * luminance to middle grey. */
export const ev100FromAvgLuminance = (avgCdM2: number): number => Math.log2((Math.max(avgCdM2, 1e-6) * 100) / 12.5);
export const avgLuminanceFromEv100 = (ev100: number): number => (2 ** ev100 * 12.5) / 100;

/** Incident-light meter (flat receptor, C = 250): EV100 for an illuminance. */
export const ev100FromIlluminance = (lux: number): number => Math.log2((Math.max(lux, 1e-9) * 100) / 250);
export const illuminanceFromEv100 = (ev100: number): number => (2 ** ev100 * 250) / 100;

/** Rec.709 relative luminance of a linear RGB triple. */
export const luminance = (c: ArrayLike<number>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function interp(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1] + (x - table[0][0]) * ((table[1][1] - table[0][1]) / (table[1][0] - table[0][0]));
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/** "Sky preset" exposure — what a photographer shooting the scene outdoors
 * would dial in, keeping sunsets and dusk moody: noon ≈ EV 15, sunset ≈ 11,
 * civil twilight 8 (−3°) … 6 (−6°), deep night ≈ 1. Keyed on the global
 * horizontal illuminance (lux) as log2(E) → EV100. */
const PRESET: readonly (readonly [number, number])[] = [
  [-6, 0.6],
  [-2, 2.0],
  [1, 4.0],
  [3.2, 6.0],
  [5.5, 7.0],
  [7.3, 8.0],
  [10, 11.2],
  [13, 13.1],
  [17, 15.0],
];
export const presetEV100 = (globalLux: number): number => Math.min(interp(PRESET, Math.log2(Math.max(globalLux, 1e-6))), 15.6);

/** "Auto" exposure keyed on the light falling on the scene: an incident
 * meter (surfaces read as themselves, half a stop open for AgX) that holds a
 * little twilight mood and never opens up past EV ≈ 0.5 at night, where the
 * venue's own lamps take over. Noon ≈ 14.9, sunset ≈ 8.1, sunset+15 min ≈
 * 6.4, night ≈ 0.5. */
export function meteredEV100(globalLux: number): number {
  // half a stop over the incident reading: AgX sits darker in the midtones
  const incident = Math.log2(Math.max(globalLux, 0) / 2.5 + 2) - 0.5;
  // twilight mood: up to +0.6 EV around a few–hundreds of lux
  const l = Math.log2(Math.max(globalLux, 1e-6));
  const mood = 0.6 * Math.exp(-(((l - 6) / 4) ** 2));
  return incident + mood;
}

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
