import * as THREE from 'three';
import { tag } from '../../render/tags';
import { exitSignTexture, entryLogoTexture, soffitPlankTextures, stuccoPierTextures } from '../texturesInterior';

/** Shared hall materials (one instance per venue build). Albedos are set
 * against the reference photos, white-normalized (walls ≈ 0xf3f1ec). */
export interface HallMaterials {
  /** smooth white interior paint */
  paint: THREE.MeshStandardMaterial;
  /** exterior render on the hall's outer faces */
  stucco: THREE.MeshStandardMaterial;
  /** annex wings (hallways, bathrooms) — unchanged warm stucco */
  annex: THREE.MeshStandardMaterial;
  /** white structure: rafters, glulams, posts, frames, mullions */
  trim: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  /** roller shades behind glass / frosted lites (south + west walls) */
  frosted: THREE.MeshStandardMaterial;
  /** ridge skylight panels */
  skylight: THREE.MeshStandardMaterial;
  /** covered-bay posts and projecting beam ends */
  sage: THREE.MeshStandardMaterial;
  /** covered-bay rake fascia */
  fascia: THREE.MeshStandardMaterial;
  soffit: THREE.MeshStandardMaterial;
  pier: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  stainless: THREE.MeshStandardMaterial;
  /** track-head housings (white powder coat) */
  fixtureWhite: THREE.MeshStandardMaterial;
  /** track-head LED lens */
  lens: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  screenBlack: THREE.MeshStandardMaterial;
  exitFace: THREE.MeshStandardMaterial;
  logo: THREE.MeshStandardMaterial;
}

export function hallMaterials(): HallMaterials {
  const soffitTex = soffitPlankTextures();
  const pierTex = stuccoPierTextures();
  const exitTex = exitSignTexture();
  return {
    paint: tag(new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.85, metalness: 0 }), 'paint-wall', {}, 'hallWalls'),
    stucco: tag(new THREE.MeshStandardMaterial({ color: 0xe6e0d1, roughness: 0.93, metalness: 0 }), 'stucco', {}, 'hallStucco'),
    annex: tag(new THREE.MeshStandardMaterial({ color: 0xe6e0d1, roughness: 0.93, metalness: 0 }), 'stucco', {}, 'walls'),
    trim: tag(new THREE.MeshStandardMaterial({ color: 0xf4f2ed, roughness: 0.6, metalness: 0 }), 'paint-trim', {}, 'whiteTrim'),
    baseboard: tag(new THREE.MeshStandardMaterial({ color: 0xfaf8f3, roughness: 0.5, metalness: 0 }), 'paint-trim', {}, 'baseboard'),
    glass: tag(
      new THREE.MeshStandardMaterial({
        color: 0xeaf4f8,
        transparent: true,
        opacity: 0.1,
        roughness: 0.06,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      'glass-clear',
      { thin: true, ior: 1.5 },
      'windows',
    ),
    frosted: tag(
      // shades read as a soft opaque fabric in the raster view; the render
      // tag carries the diffuse transmission
      new THREE.MeshStandardMaterial({ color: 0xf2f3f1, roughness: 0.9, metalness: 0 }),
      'glass-frosted',
      { thin: true, transmission: 0.35, ior: 1.5 },
      'rollerShades',
    ),
    skylight: tag(
      new THREE.MeshStandardMaterial({
        color: 0xe6edf0,
        transparent: true,
        opacity: 0.5,
        roughness: 0.45,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      'glass-frosted',
      { thin: true, transmission: 0.85, ior: 1.5 },
      'ridgeSkylight',
    ),
    sage: tag(new THREE.MeshStandardMaterial({ color: 0x8e9380, roughness: 0.7, metalness: 0 }), 'paint-trim', {}, 'sagePaint'),
    fascia: tag(new THREE.MeshStandardMaterial({ color: 0xbdb7a6, roughness: 0.75, metalness: 0 }), 'paint-trim', {}, 'bayFascia'),
    soffit: tag(
      new THREE.MeshStandardMaterial({ map: soffitTex.map, bumpMap: soffitTex.bumpMap, bumpScale: 0.04, roughness: 0.7, metalness: 0 }),
      'wood-rail',
      {},
      'baySoffit',
    ),
    pier: tag(
      new THREE.MeshStandardMaterial({ map: pierTex.map, bumpMap: pierTex.bumpMap, bumpScale: 0.08, roughness: 0.95, metalness: 0 }),
      'stucco',
      {},
      'bayPier',
    ),
    metalDark: tag(new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.55, metalness: 0.3 }), 'metal-dark', {}, 'hallBlackMetal'),
    stainless: tag(new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9 }), 'metal-stainless', {}, 'doorPulls'),
    fixtureWhite: tag(new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.45, metalness: 0.1 }), 'paint-trim', {}, 'trackWhite'),
    lens: tag(
      new THREE.MeshStandardMaterial({ color: 0xfff4e6, emissive: 0xffe2bd, emissiveIntensity: 3.2, roughness: 0.3, metalness: 0 }),
      'emitter-fixture',
      { luminance: 5e4, castShadow: false },
      'trackLens',
    ),
    screen: tag(new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.95, metalness: 0 }), 'fabric', {}, 'projScreen'),
    screenBlack: tag(new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9, metalness: 0 }), 'fabric', {}, 'projScreenBorder'),
    exitFace: tag(
      new THREE.MeshStandardMaterial({ map: exitTex, emissiveMap: exitTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0 }),
      'emitter-fixture',
      { luminance: 150 },
      'exitSign',
    ),
    logo: tag(
      new THREE.MeshStandardMaterial({
        map: entryLogoTexture(),
        color: 0xf6f8f8,
        transparent: true,
        opacity: 0.85,
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      'glass-frosted',
      { thin: true, transmission: 0.4 },
      'entryLogo',
    ),
  };
}
