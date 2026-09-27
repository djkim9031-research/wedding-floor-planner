import type { UNet } from 'oidn-web';

/** Open Image Denoise (the same network Blender/Cycles uses) running on
 * WebGPU. Returns null when WebGPU is unavailable so callers fall back. */

let unets: Partial<Record<'small' | 'full', Promise<UNet | null>>> = {};

export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function weightsUrl(kind: 'small' | 'full'): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return `${base}oidn/rt_hdr_alb_nrm${kind === 'small' ? '_small' : ''}.tza`;
}

async function loadUNet(kind: 'small' | 'full'): Promise<UNet | null> {
  if (!webgpuAvailable()) return null;
  if (location.protocol === 'file:') return null; // weights can't be fetched from file://
  try {
    const { initUNetFromURL } = await import('oidn-web');
    return await initUNetFromURL(weightsUrl(kind), undefined, { aux: true, hdr: true });
  } catch (e) {
    console.warn('OIDN unavailable:', e);
    return null;
  }
}

function getUNet(kind: 'small' | 'full'): Promise<UNet | null> {
  return (unets[kind] ??= loadUNet(kind));
}

export interface DenoiseInput {
  /** linear radiance, RGBA float, GL row order */
  color: Float32Array;
  albedo: Uint8ClampedArray<ArrayBuffer>;
  normal: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** multiply into the network's working range (≈ display exposure) */
  scale: number;
  kind: 'small' | 'full';
}

/** Denoise; resolves with linear radiance in the input's units, or null. */
export async function denoise(inp: DenoiseInput, signal?: AbortSignal): Promise<Float32Array | null> {
  const unet = await getUNet(inp.kind);
  if (!unet || signal?.aborted) return null;
  const n = inp.width * inp.height * 4;
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    scaled[i] = inp.color[i] * inp.scale;
    scaled[i + 1] = inp.color[i + 1] * inp.scale;
    scaled[i + 2] = inp.color[i + 2] * inp.scale;
    scaled[i + 3] = 1;
  }
  return new Promise<Float32Array | null>((resolve) => {
    let abort: (() => void) | undefined;
    const onAbort = () => {
      abort?.();
      resolve(null);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      abort = unet.tileExecute({
        color: { data: scaled, width: inp.width, height: inp.height },
        albedo: new ImageData(inp.albedo, inp.width, inp.height),
        normal: new ImageData(inp.normal, inp.width, inp.height),
        done: (out) => {
          signal?.removeEventListener('abort', onAbort);
          const d = (out as { data: Float32Array }).data;
          const inv = 1 / inp.scale;
          for (let i = 0; i < n; i += 4) {
            d[i] *= inv;
            d[i + 1] *= inv;
            d[i + 2] *= inv;
            d[i + 3] = 1;
          }
          resolve(d);
        },
      }) as unknown as () => void;
    } catch (e) {
      console.warn('OIDN failed:', e);
      resolve(null);
    }
  });
}
