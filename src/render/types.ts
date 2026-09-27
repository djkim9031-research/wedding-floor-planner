import type * as THREE from 'three';

/** Physical role of a surface. Tagged where each material is created, so the
 * path tracer and the Blender export map roles to physical materials instead
 * of guessing from colors. Also encoded in the material name as
 * "<role>__<id>" — the one channel guaranteed to survive glTF → Blender. */
export type MaterialRole =
  | 'wood-floor'
  | 'wood-deck'
  | 'wood-table'
  | 'wood-rail'
  | 'reed'
  | 'paint-wall'
  | 'paint-trim'
  | 'stucco'
  | 'stone'
  | 'glass-clear'
  | 'glass-frosted'
  | 'glass-tableware'
  | 'linen'
  | 'fabric'
  | 'foliage'
  | 'bark'
  | 'metal-stainless'
  | 'metal-dark'
  | 'ceramic'
  | 'soil'
  | 'asphalt'
  | 'ground'
  | 'skin'
  | 'emitter-flame'
  | 'emitter-led'
  | 'emitter-fixture'
  | 'backplate'
  | 'generic';

export interface PbrTag {
  role: MaterialRole;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  transmission?: number;
  ior?: number;
  /** single-surface glass (no exit face) */
  thin?: boolean;
  /** 0..1 diffuse transmission for thin leaves / cloth */
  translucency?: number;
  /** emitters: surface luminance, cd/m² */
  luminance?: number;
  /** false → invisible to shadow rays (flames around a light, backplates) */
  castShadow?: boolean;
  /** visible to camera rays only */
  cameraOnly?: boolean;
}

export interface ObjectRenderTag {
  /** never part of a render (helpers, UI, debug) */
  exclude?: boolean;
  /** 'live' = editing detail only, 'render' = photo/Blender detail only */
  lod?: 'live' | 'render';
}

export type LightGroup = 'interior' | 'deck' | 'porch' | 'decor' | 'sky';

export interface LightDef {
  id: string;
  kind: 'spot' | 'point' | 'directional';
  group: LightGroup;
  /** three world, meters (ignored for directional) */
  position: [number, number, number];
  /** direction the light travels (spot / directional), three world */
  direction?: [number, number, number];
  colorLinear: [number, number, number];
  cct?: number;
  intensityCd?: number;
  illuminanceLux?: number;
  halfAngleDeg?: number;
  penumbra?: number;
  radiusM?: number;
  /** material name of an emitter mesh around this light (hidden from shadow rays) */
  shadowlessEmitter?: string;
  /** how the in-app path tracer treats it (it samples lights uniformly) */
  ptMode: 'light' | 'emitter-only' | 'omit';
}

export interface RenderSceneOptions {
  target: 'pathtracer' | 'gltf';
  includeRoof: boolean;
}

export interface RenderSceneStats {
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  lights: number;
  buildMs: number;
}

export interface RenderSceneResult {
  scene: THREE.Scene;
  lights: LightDef[];
  /** material name → tag */
  roles: Record<string, PbrTag>;
  stats: RenderSceneStats;
  /** frees clones only — never the live scene's shared textures */
  dispose(): void;
}
