import type * as THREE from 'three';

/** Path tracer quality presets picked from the GPU. The 2019 16" MacBook Pro
 * (Radeon Pro 5300M/5500M, 4 GB) is the design target for 'mid'. */
export type GpuTier = 'low' | 'mid' | 'high';

export interface PtPreset {
  tier: GpuTier;
  gpu: string;
  /** path-traced buffer size relative to the drawing buffer */
  renderScale: number;
  tiles: number;
  bounces: number;
  transmissiveBounces: number;
  /** texture array layer size (all scene textures are resampled to this) */
  textureSize: number;
  /** stop sampling here (thermals) */
  maxSamples: number;
  /** denoise automatically once this many samples have accumulated */
  denoiseAt: number;
}

export function detectGpu(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(s ?? 'unknown');
}

export function presetFor(renderer: THREE.WebGLRenderer): PtPreset {
  const gpu = detectGpu(renderer);
  const g = gpu.toLowerCase();
  const software = /swiftshader|llvmpipe|software|microsoft basic/.test(g);
  const integrated = /intel|iris|uhd|hd graphics|mali|adreno/.test(g) && !/arc/.test(g);
  const high = /apple m[2-9]|m[2-9] (pro|max|ultra)|rtx|radeon rx [67]|rx 7|rx 6[89]|geforce (30|40|50)/.test(g);
  if (software || integrated) {
    return { tier: 'low', gpu, renderScale: 0.5, tiles: 2, bounces: 4, transmissiveBounces: 4, textureSize: 512, maxSamples: 256, denoiseAt: 32 };
  }
  if (high) {
    return { tier: 'high', gpu, renderScale: 1, tiles: 1, bounces: 8, transmissiveBounces: 8, textureSize: 1024, maxSamples: 1024, denoiseAt: 64 };
  }
  // Radeon Pro 5300M/5500M/5600M, 555X/560X, Vega 16/20, Apple M1, GTX 16xx…
  return { tier: 'mid', gpu, renderScale: 0.6, tiles: 2, bounces: 6, transmissiveBounces: 6, textureSize: 1024, maxSamples: 512, denoiseAt: 48 };
}
