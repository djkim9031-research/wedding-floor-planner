import * as THREE from 'three';
import { EXRExporter, ZIP_COMPRESSION } from 'three/examples/jsm/exporters/EXRExporter.js';
import type { EquirectImage } from '../../sky/types';

/** Sky radiance for Blender: cd/m² → W/m²/sr (÷683), float EXR. The
 * exporter flips rows, so the file's top scanline is the zenith. */
export async function skyToExr(img: EquirectImage): Promise<Uint8Array> {
  const data = new Float32Array(img.data.length);
  const k = 1 / 683;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = img.data[i] * k;
    data[i + 1] = img.data[i + 1] * k;
    data[i + 2] = img.data[i + 2] * k;
    data[i + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, img.w, img.h, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  const out = await new EXRExporter().parse(tex, { type: THREE.FloatType, compression: ZIP_COMPRESSION });
  tex.dispose();
  return out as Uint8Array;
}
