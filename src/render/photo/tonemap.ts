/** CPU port of three.js's AgX tone mapping (tonemapping_pars_fragment), so a
 * saved photo matches what the canvas shows. GLSL mat3(c0, c1, c2) takes
 * columns; `mul` applies a column-major 3×3. */

type M3 = readonly [number, number, number, number, number, number, number, number, number];

const SRGB_TO_2020: M3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956];
const R2020_TO_SRGB: M3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const INSET: M3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859,
];
const OUTSET: M3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272,
  -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

function mul(m: M3, r: number, g: number, b: number, out: number[]): void {
  out[0] = m[0] * r + m[3] * g + m[6] * b;
  out[1] = m[1] * r + m[4] * g + m[7] * b;
  out[2] = m[2] * r + m[5] * g + m[8] * b;
}

const sigmoid = (x: number): number => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};

const toSrgb8 = (c: number): number => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(v, 0), 1) * 255);
};

/** Linear float RGBA (GL rows, bottom-up) → sRGB 8-bit RGBA (top-down rows). */
export function agxToImage(src: Float32Array, w: number, h: number, exposure: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  const t = [0, 0, 0];
  const u = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const srow = (h - 1 - y) * w * 4;
    const drow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const si = srow + x * 4;
      const di = drow + x * 4;
      mul(SRGB_TO_2020, src[si] * exposure, src[si + 1] * exposure, src[si + 2] * exposure, t);
      mul(INSET, t[0], t[1], t[2], u);
      for (let k = 0; k < 3; k++) {
        const l = (Math.log2(Math.max(u[k], 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV);
        u[k] = sigmoid(Math.min(Math.max(l, 0), 1));
      }
      mul(OUTSET, u[0], u[1], u[2], t);
      for (let k = 0; k < 3; k++) t[k] = Math.pow(Math.max(t[k], 0), 2.2);
      mul(R2020_TO_SRGB, t[0], t[1], t[2], u);
      out[di] = toSrgb8(Math.min(Math.max(u[0], 0), 1));
      out[di + 1] = toSrgb8(Math.min(Math.max(u[1], 0), 1));
      out[di + 2] = toSrgb8(Math.min(Math.max(u[2], 0), 1));
      out[di + 3] = 255;
    }
  }
  return out;
}

/** 8-bit RGBA (top-down) → PNG blob. */
export function imageToPng(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}
