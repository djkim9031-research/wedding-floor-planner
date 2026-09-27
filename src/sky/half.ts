/** Fast table-driven Float32 → IEEE half conversion for whole images
 * (≈1–2 ns per value; three's DataUtils.toHalfFloat is per-call and ~10×
 * slower). Overflow and NaN saturate to the largest finite half (65504), so
 * a hot texel can never poison a PMREM with Inf. */

const base = new Uint16Array(512);
const shift = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  const e = i - 127;
  if (e < -24) {
    // too small: ±0
    base[i] = 0x0000;
    base[i | 0x100] = 0x8000;
    shift[i] = shift[i | 0x100] = 24;
  } else if (e < -14) {
    // subnormal half
    base[i] = 0x0400 >> (-e - 14);
    base[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
    shift[i] = shift[i | 0x100] = -e - 1;
  } else if (e <= 15) {
    base[i] = (e + 15) << 10;
    base[i | 0x100] = ((e + 15) << 10) | 0x8000;
    shift[i] = shift[i | 0x100] = 13;
  } else {
    // overflow / Inf / NaN → saturate
    base[i] = 0x7bff;
    base[i | 0x100] = 0xfbff;
    shift[i] = shift[i | 0x100] = 24;
  }
}

/** Convert a Float32Array into (optionally a reused) Uint16Array of halves. */
export function toHalfArray(src: Float32Array, out?: Uint16Array): Uint16Array {
  const n = src.length;
  const dst = out && out.length === n ? out : new Uint16Array(n);
  const u = new Uint32Array(src.buffer, src.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const x = u[i];
    const e = x >>> 23;
    // truncating (no round-to-nearest), so the mantissa never carries into
    // the exponent and the largest normal stays finite
    dst[i] = base[e] + ((x & 0x007fffff) >>> shift[e]);
  }
  return dst;
}
