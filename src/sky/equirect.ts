import type { EquirectImage, Vec3 } from './types';

/** three.js equirect convention (rows bottom-up): u = atan2(z, x)/2π + 0.5,
 * v = asin(y)/π + 0.5. */
export function equirectUv(d: ArrayLike<number>): [number, number] {
  const u = Math.atan2(d[2], d[0]) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, d[1]))) / Math.PI + 0.5;
  return [u, v];
}

export function dirFromEquirectUv(u: number, v: number): Vec3 {
  const az = (u - 0.5) * 2 * Math.PI;
  const el = (v - 0.5) * Math.PI;
  const c = Math.cos(el);
  return [c * Math.cos(az), Math.sin(el), c * Math.sin(az)];
}

/** Model-frame unit vector for a model azimuth (0 = −z, clockwise from above)
 * and elevation, both degrees — same frame as sunDirModel(). */
export function dirFromModelAzEl(azModelDeg: number, elDeg: number): Vec3 {
  const a = (azModelDeg * Math.PI) / 180;
  const h = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
}

/** Bilinear RGB sample of an equirect image in a direction. */
export function sampleEquirect(img: EquirectImage, d: ArrayLike<number>): Vec3 {
  const [u, v] = equirectUv(d);
  const { w, h, data } = img;
  const fx = u * w - 0.5;
  const fy = Math.min(Math.max(v * h - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.min(Math.floor(fy), h - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const out: Vec3 = [0, 0, 0];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const xx = (((x0 + i) % w) + w) % w;
      const wt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const o = ((y0 + j) * w + xx) * 4;
      out[0] += data[o] * wt;
      out[1] += data[o + 1] * wt;
      out[2] += data[o + 2] * wt;
    }
  }
  return out;
}

/** Sky luminance (RGB, cd/m²) just above the horizon toward a model azimuth. */
export function horizonLuminance(img: EquirectImage, azModelDeg: number, elDeg = 2): Vec3 {
  return sampleEquirect(img, dirFromModelAzEl(azModelDeg, elDeg));
}
