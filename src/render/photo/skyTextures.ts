import * as THREE from 'three';
import type { EquirectImage } from '../../sky/types';

/** Wrap a sky equirect (Float32 RGBA, rows bottom-up) as a texture the path
 * tracer can importance-sample. Reuses the texture when the size matches. */
export function equirectTexture(img: EquirectImage, prev?: THREE.DataTexture | null): THREE.DataTexture {
  if (prev && prev.image.width === img.w && prev.image.height === img.h) {
    (prev.image.data as Float32Array).set(img.data);
    prev.needsUpdate = true;
    return prev;
  }
  prev?.dispose();
  const tex = new THREE.DataTexture(new Float32Array(img.data), img.w, img.h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
