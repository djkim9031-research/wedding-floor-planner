import * as THREE from 'three';
import { i2m, ROOM_D, ROOM_W } from '../constants';
import { tag } from '../render/tags';
import { dirFromModelAzEl, horizonLuminance, sampleEquirect } from '../sky/equirect';
import { luminance } from '../sky/exposure';
import type { SkyState } from '../sky/types';
import { bayPanoramaTexture, treetopRingTexture } from './textures';

// ---------------------------------------------------------------------------
// Valley backdrop, treetop ring and fog. The sky itself is scene.background
// (the physical sky, see lighting.ts); these painted backplates are unlit
// MeshBasic, so they are tinted per azimuth from the sky's horizon luminance
// (cd/m²) — the renderer's exposure then places them like every lit surface.
// ---------------------------------------------------------------------------

export interface Atmosphere {
  valleyMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  fog: THREE.Fog;
  /** retint the backplates and the fog from the current physical sky */
  applySky(sky: SkyState): void;
}

/** Per-vertex model azimuths of an open cylinder (three's layout: x = r·sinθ,
 * z = r·cosθ), for tinting by direction. */
function vertexAzimuths(geo: THREE.BufferGeometry): Float32Array {
  const pos = geo.getAttribute('position');
  const az = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    // model azimuth: 0 = −z, 90 = +x
    az[i] = (Math.atan2(pos.getX(i), -pos.getZ(i)) * 180) / Math.PI;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
  return az;
}

export function applyAtmosphere(scene: THREE.Scene): Atmosphere {
  scene.fog = new THREE.Fog(0xe8eef2, 45, 160);

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);

  // full-circle Bay Area panorama; haze baked in, so fog:false
  const valleyGeo = new THREE.CylinderGeometry(85, 85, 40, 96, 1, true);
  const valleyAz = vertexAzimuths(valleyGeo);
  const valley = new THREE.Mesh(
    valleyGeo,
    tag(
      new THREE.MeshBasicMaterial({
        map: bayPanoramaTexture(),
        side: THREE.BackSide,
        transparent: true,
        fog: false,
        depthWrite: false,
        vertexColors: true,
      }),
      'backplate',
      { cameraOnly: true, castShadow: false },
      'bayPanorama',
    ),
  );
  valley.position.set(cx, 7, cz);
  valley.renderOrder = -1;
  scene.add(valley);

  // ground plane to the horizon: a broad lawn disc under everything, so
  // downward views land on grass (it takes the scene lights, darkening at
  // night) instead of the void behind the backdrop
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(260, 48),
    tag(new THREE.MeshStandardMaterial({ color: 0x76825a, roughness: 1, metalness: 0 }), 'ground', {}, 'lawn'),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, -0.55, cz);
  scene.add(lawn);

  // near treetop ring just past the knoll: crowns rise above deck level and
  // parallax against the painted valley as the camera moves
  const ringGeo = new THREE.CylinderGeometry(58, 58, 13, 96, 1, true);
  const ringAz = vertexAzimuths(ringGeo);
  const ring = new THREE.Mesh(
    ringGeo,
    tag(
      new THREE.MeshBasicMaterial({
        map: treetopRingTexture(),
        side: THREE.BackSide,
        transparent: true,
        alphaTest: 0.35,
        depthWrite: false,
        vertexColors: true,
      }),
      'backplate',
      { cameraOnly: true, castShadow: false },
      'treetopRing',
    ),
  );
  ring.position.set(cx, -0.8, cz);
  ring.renderOrder = -1;
  scene.add(ring);

  const valleyMat = valley.material as THREE.MeshBasicMaterial;
  const ringMat = ring.material as THREE.MeshBasicMaterial;
  const fog = scene.fog as THREE.Fog;

  // horizon luminance per 5° of azimuth, reused for every vertex
  const STEP = 5;
  const table: [number, number, number][] = [];

  const applySky = (sky: SkyState): void => {
    // sky irradiance on the landscape (coarse cosine-weighted dome integral)
    const eSky: [number, number, number] = [0, 0, 0];
    const dEl = (10 * Math.PI) / 180;
    const dAz = (15 * Math.PI) / 180;
    for (let el = 5; el < 90; el += 10) {
      const e = (el * Math.PI) / 180;
      const w = Math.sin(e) * Math.cos(e) * dEl * dAz;
      for (let az = 0; az < 360; az += 15) {
        const L = sampleEquirect(sky.env, dirFromModelAzEl(az, el));
        eSky[0] += L[0] * w;
        eSky[1] += L[1] * w;
        eSky[2] += L[2] * w;
      }
    }
    const sunY = Math.max(luminance(sky.sun.colorLinear), 1e-6);
    const sunRgb = sky.sun.colorLinear.map((c) => (c / sunY) * sky.sun.illuminanceLux);
    const alt = (sky.sun.altDeg * Math.PI) / 180;
    const sd = sky.sun.dir;
    const sh = Math.hypot(sd[0], sd[2]) || 1;

    table.length = 0;
    const hz: [number, number, number] = [0, 0, 0];
    for (let a = 0; a < 360; a += STEP) {
      const L = horizonLuminance(sky.env, a, 1.5);
      table.push(L);
      hz[0] += L[0];
      hz[1] += L[1];
      hz[2] += L[2];
    }
    const n = table.length;

    // Painted texels act like albedo × 3 (≈0.3–0.6 for 0.1–0.2 landscape);
    // far layers are part lit landscape, part aerial haze (the horizon sky)
    const ALB = 0.3;
    const HAZE_L = 1.6; // texel ≈ 0.6 → haze reads at the horizon luminance
    const lit = (az: number, out: number[]): void => {
      // landscape faces the viewer: normal = −view direction
      const ar = (az * Math.PI) / 180;
      const facing = Math.max(0, -(Math.sin(ar) * sd[0] - Math.cos(ar) * sd[2]) / sh);
      const kSun = Math.max(0, 0.6 * Math.sin(alt) + 0.5 * facing * Math.cos(alt));
      for (let c = 0; c < 3; c++) out[c] = ((0.8 * eSky[c] + kSun * sunRgb[c]) / Math.PI) * ALB;
    };
    const tmp = [0, 0, 0];
    const tint = (az: number, haze: number, out: Float32Array, o: number): void => {
      const u = ((az % 360) + 360) % 360;
      const f = (u / STEP) | 0;
      const t = u / STEP - f;
      const A = table[f % n];
      const B = table[(f + 1) % n];
      lit(u, tmp);
      for (let c = 0; c < 3; c++) {
        const h = (A[c] * (1 - t) + B[c] * t) * HAZE_L;
        out[o + c] = tmp[c] * (1 - haze) + h * haze;
      }
    };
    const paint = (geo: THREE.BufferGeometry, az: Float32Array, haze: number): void => {
      const col = geo.getAttribute('color') as THREE.BufferAttribute;
      const arr = col.array as Float32Array;
      for (let i = 0; i < az.length; i++) tint(az[i], haze, arr, i * 3);
      col.needsUpdate = true;
    };
    // far ridge / bay / canopy shelf: a third haze; near crowns: little
    paint(valleyGeo, valleyAz, 0.3);
    paint(ringGeo, ringAz, 0.12);

    // fog: aerial perspective over tens of metres (the linear ramp is strong,
    // so the target sits between the lit landscape and the horizon haze)
    lit(0, tmp);
    fog.color.setRGB(
      0.6 * (hz[0] / n) + 0.4 * tmp[0] * 3,
      0.6 * (hz[1] / n) + 0.4 * tmp[1] * 3,
      0.6 * (hz[2] / n) + 0.4 * tmp[2] * 3,
      THREE.LinearSRGBColorSpace,
    );
  };

  return { valleyMat, ringMat, fog, applySky };
}
