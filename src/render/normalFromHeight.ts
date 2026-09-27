import * as THREE from 'three';

/** Bump → normal conversion. The path tracer and glTF→Blender only carry
 * tangent-space normal maps, so every bumpMap is baked once into one.
 *
 * Layout contract of the pure function: `heights[row * w + col]`, heights in
 * 0..1, **row 0 = texture v 0** (bottom) — row index grows with +V, column
 * with +U. Output is RGBA8 in the same row order (A = 255), OpenGL
 * convention: R = +U (tangent), G = +V (bitangent), B = surface normal —
 * the convention three.js (tangent-less `getTangentFrame`), three-gpu-
 * pathtracer (`cross(n, t) * w` bitangent from `computeTangents`) and glTF
 * (after GLTFExporter's own green flip for tangent-less meshes) all read.
 *
 * n = normalize(−s·∂h/∂u, −s·∂h/∂v, 1), central differences in texel units,
 * so `strength` s is "relief per texel": a height step of Δ between texels
 * tilts the normal by atan(s·Δ/2) per neighbour.
 */
export interface NormalFromHeightOptions {
  /** sample across the left/right edge (RepeatWrapping) — default true */
  wrapX?: boolean;
  /** sample across the top/bottom edge — default true */
  wrapY?: boolean;
}

export function normalFromHeight(
  heights: Float32Array,
  w: number,
  h: number,
  strength: number,
  opts: NormalFromHeightOptions = {},
): Uint8Array {
  const wrapX = opts.wrapX ?? true;
  const wrapY = opts.wrapY ?? true;
  const out = new Uint8Array(w * h * 4);
  const col = (x: number) => (wrapX ? (x + w) % w : Math.min(Math.max(x, 0), w - 1));
  const row = (y: number) => (wrapY ? (y + h) % h : Math.min(Math.max(y, 0), h - 1));
  // neighbour columns + 1/span, hoisted out of the pixel loop; a one-sided
  // difference at a clamped edge spans one texel, two elsewhere
  const xm = new Int32Array(w);
  const xp = new Int32Array(w);
  const sx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    xm[x] = col(x - 1);
    xp[x] = col(x + 1);
    sx[x] = -strength / (wrapX || (x > 0 && x < w - 1) ? 2 : Math.max(xp[x] - xm[x], 1));
  }
  for (let y = 0; y < h; y++) {
    const r = y * w;
    const r0 = row(y - 1) * w;
    const r1 = row(y + 1) * w;
    const sy = -strength / (wrapY || (y > 0 && y < h - 1) ? 2 : Math.max(row(y + 1) - row(y - 1), 1));
    for (let x = 0; x < w; x++) {
      const nx = (heights[r + xp[x]] - heights[r + xm[x]]) * sx[x];
      const ny = (heights[r1 + x] - heights[r0 + x]) * sy;
      const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (r + x) * 4;
      // (n·0.5 + 0.5)·255, rounded
      out[o] = (nx * inv + 128) | 0;
      out[o + 1] = (ny * inv + 128) | 0;
      out[o + 2] = (inv + 128) | 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Normal-map strength for a three.js bumpScale.
 *
 * three r151+ `perturbNormalArb` normalizes the screen-space position
 * derivatives, so a bump map tilts the normal by bumpScale·Δheight per
 * *screen pixel*, while the baked map tilts by strength·Δheight per
 * *texel*. For relief wider than a texel the two agree when
 *   strength = bumpScale × (texels per screen pixel)
 * at the viewing distance that matters. Reference density: 2 texels/px —
 * floor 2048² over 128" ≈ 1.6 mm/texel, deck 2048² over 96" ≈ 1.2 mm,
 * linen 128² over 8" ≈ 1.6 mm, against ≈ 3.6 mm/px at 5 m (1280 px wide,
 * 50° FOV) → 2.3 / 3 / 1.4 texels per pixel. Closer than that the raster
 * bump fades (fewer texels per pixel) while the baked map holds, which is
 * the physically right behaviour. */
export const BUMP_REF_TEXELS_PER_PIXEL = 2;
export const bumpScaleToStrength = (bumpScale: number): number => bumpScale * BUMP_REF_TEXELS_PER_PIXEL;

type Pixels = { data: ArrayLike<number>; width: number; height: number; channels: number };

/** Read a texture's image as grayscale-able pixels in *image* row order
 * (row 0 = first row of the source image / data). */
function readPixels(tex: THREE.Texture): Pixels | null {
  const img = tex.image as unknown;
  if (!img) return null;
  const d = img as { data?: ArrayLike<number>; width?: number; height?: number };
  if (d.data && d.width && d.height) {
    const channels = Math.round(d.data.length / (d.width * d.height));
    if (channels < 1) return null;
    return { data: d.data, width: d.width, height: d.height, channels };
  }
  if (typeof document === 'undefined') return null;
  const src = img as CanvasImageSource & { width: number; height: number };
  const w = (img as HTMLImageElement).naturalWidth || src.width;
  const h = (img as HTMLImageElement).naturalHeight || src.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(src, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, width: w, height: h, channels: 4 };
}

/** Heights (0..1, red channel) in the pure function's v-up row order. */
export function heightsFromTexture(tex: THREE.Texture): { heights: Float32Array; w: number; h: number } | null {
  const px = readPixels(tex);
  if (!px) return null;
  const { data, width: w, height: h, channels } = px;
  const isFloat = !(data instanceof Uint8Array || data instanceof Uint8ClampedArray);
  const scale = isFloat ? 1 : 1 / 255;
  const heights = new Float32Array(w * h);
  // canvas/image rows run top-down; with flipY the top row lands at v = 1,
  // so reverse them. Raw data textures (flipY false) are already v-up.
  const flip = tex.flipY && !(tex as THREE.DataTexture).isDataTexture;
  for (let y = 0; y < h; y++) {
    const srcRow = flip ? h - 1 - y : y;
    for (let x = 0; x < w; x++) heights[y * w + x] = data[(srcRow * w + x) * channels] * scale;
  }
  return { heights, w, h };
}

/** Baked pixels, shared across render builds: canvas readback + baking a
 * 2048² map costs ~0.3 s (and the very first 2D readback of a session can
 * stall several seconds on software GL), so each (bump image, version,
 * strength, wrap) is baked once per session. Holds CPU pixels only; GPU
 * copies belong to the per-build textures and are freed with them. */
interface Baked {
  source: THREE.Texture['source'];
  /** canvas-backed (image rows top-down → upload with flipY) */
  canvas: boolean;
}
const baked = new Map<string, Baked>();
const BAKED_MAX = 24;

/** Drop every cached bake (e.g. after regenerating procedural textures). */
export function clearNormalMapCache(): void {
  baked.clear();
}

/** Encode v-up RGBA rows as a texture. In a browser it is canvas-backed
 * (rows written top-down, uploaded with flipY) because GLTFExporter can
 * only re-encode drawable images — it flips the green channel of normal
 * maps on tangent-less meshes via drawImage. Elsewhere a DataTexture. */
function encode(data: Uint8Array, w: number, h: number): { tex: THREE.Texture; canvas: boolean } {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) {
      const img = g.createImageData(w, h);
      const row = w * 4;
      for (let y = 0; y < h; y++) img.data.set(data.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.flipY = true;
      return { tex, canvas: true };
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = false; // rows are already v-up
  return { tex, canvas: false };
}

/** Tangent-space normal map for a bump texture. The texture keeps the
 * bump's own transform (repeat/offset/rotation/center/channel) and wrap
 * modes; its pixels come from the session cache. Returns null when the
 * image can't be read. Callers own (dispose) it. */
export function normalMapFromBump(bump: THREE.Texture, strength: number): THREE.Texture | null {
  const wrapX = bump.wrapS !== THREE.ClampToEdgeWrapping;
  const wrapY = bump.wrapT !== THREE.ClampToEdgeWrapping;
  const prefix = `${bump.source.uuid}|`;
  const version = `${prefix}${bump.source.version}|`;
  const key = `${version}${strength}|${wrapX}|${wrapY}|${bump.flipY}`;
  let entry = baked.get(key);
  let tex: THREE.Texture;
  if (entry) {
    // same kind of texture as the bake (three uploads raw data only for
    // DataTextures), sharing its Source
    tex = entry.canvas ? new THREE.CanvasTexture(undefined as unknown as HTMLCanvasElement) : new THREE.DataTexture(null, 1, 1);
    (tex as unknown as { source: unknown }).source = entry.source;
    tex.flipY = entry.canvas;
  } else {
    const hm = heightsFromTexture(bump);
    if (!hm) return null;
    const data = normalFromHeight(hm.heights, hm.w, hm.h, strength, { wrapX, wrapY });
    const enc = encode(data, hm.w, hm.h);
    tex = enc.tex;
    entry = { source: tex.source, canvas: enc.canvas };
    // forget bakes of older versions of this image
    for (const k of [...baked.keys()]) if (k.startsWith(prefix) && !k.startsWith(version)) baked.delete(k);
    if (baked.size >= BAKED_MAX) baked.delete(baked.keys().next().value!);
    baked.set(key, entry);
  }
  tex.name = `${bump.name || 'bump'}_nrm`;
  tex.colorSpace = THREE.NoColorSpace;
  tex.format = THREE.RGBAFormat;
  tex.wrapS = bump.wrapS;
  tex.wrapT = bump.wrapT;
  tex.repeat.copy(bump.repeat);
  tex.offset.copy(bump.offset);
  tex.center.copy(bump.center);
  tex.rotation = bump.rotation;
  tex.matrixAutoUpdate = bump.matrixAutoUpdate;
  if (!bump.matrixAutoUpdate) tex.matrix.copy(bump.matrix);
  tex.channel = bump.channel;
  tex.anisotropy = bump.anisotropy;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
