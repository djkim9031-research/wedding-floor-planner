import * as THREE from 'three';
import type { ClothManager } from '../cloth';
import type { SceneHost } from '../scene/scene';
import type { SkyState } from '../sky/types';
import { drawParts, isNormalized, mergeTransformed, normalizeGeometry } from './geometryNormalize';
import { collectLights, lightObjects } from './lightsCollect';
import { horizonLuminance, isConvertible, PbrMaterialCache } from './materialsPbr';
import { pbrOf, renderTagOf } from './tags';
import type { LightDef, RenderSceneOptions, RenderSceneResult } from './types';

/** Render-scene builder: a clean, render-only THREE.Scene from the live
 * planner scene, for the in-app path tracer ('pathtracer') and the Blender
 * glTF export ('gltf').
 *
 * - Sources: venueGroup, exteriorGroup, itemsGroup, plus role-tagged meshes
 *   hung directly on the scene root (lawn, backplates). Never the overlay
 *   group, scene-root lights/helpers or untagged root meshes.
 * - Roof included iff `includeRoof` (whatever its live visibility); other
 *   objects follow visibility; `userData.render.exclude` / lod 'live' skip.
 * - Lines / points / sprites / helpers / non-PBR materials are dropped
 *   (MeshBasic backplates become emitters). Items keep only meshes carrying
 *   an itemId (drops selection plates and outlines). Live cloth meshes are
 *   replaced by `ClothManager.snapshot()`.
 * - Output is flat: every mesh is a direct scene child. 'pathtracer' shares
 *   one normalized geometry per source geometry and keeps
 *   matrix = matrixWorld (the path tracer bakes transforms itself);
 *   InstancedMesh and cloth are baked to world space. 'gltf' bakes every
 *   transform (and flatShading) into per-mesh geometry. */

export interface BuildRenderSceneOptions extends RenderSceneOptions {
  sky: SkyState;
  /** light importance reference (defaults to the host's active camera) */
  camera?: THREE.Camera | null;
}

export interface BuiltRenderScene extends RenderSceneResult {
  /** source materials that carried no role tag ("name (type)") */
  untagged: string[];
  /** cloth vertex counts: live meshes vs snapshot vs emitted render meshes */
  clothVerts: { live: number; snapshot: number; output: number };
  target: RenderSceneOptions['target'];
  /** per-phase build times, ms (diagnostics) */
  timings: Record<string, number>;
}

interface Part {
  material: THREE.Material;
  range?: { start: number; count: number };
}

export function buildRenderScene(host: SceneHost, clothMgr: ClothManager, opts: BuildRenderSceneOptions): BuiltRenderScene {
  const t0 = performance.now();
  const { target, includeRoof } = opts;
  const scene = new THREE.Scene();
  scene.name = `render-scene:${target}`;
  host.scene.updateMatrixWorld(true);
  host.roof.updateMatrixWorld(true);

  const mats = new PbrMaterialCache({ horizonLuminance: horizonLuminance(opts.sky) });
  const owned = new Set<THREE.BufferGeometry>();
  const shared = new Map<string, THREE.BufferGeometry | null>(); // pathtracer geometry cache
  const baseCache = new Map<string, THREE.BufferGeometry | null>(); // instancing bases
  let meshCount = 0;
  let triangles = 0;
  let geomMs = 0;
  const timed = <T>(fn: () => T): T => {
    const t = performance.now();
    const r = fn();
    geomMs += performance.now() - t;
    return r;
  };

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, src: THREE.Object3D, world: THREE.Matrix4 | null, extra: Record<string, unknown> = {}): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = src.name || material.name || src.type;
    mesh.matrixAutoUpdate = false;
    if (world) {
      mesh.matrix.copy(world);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixWorld.copy(world);
    }
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.frustumCulled = false;
    mesh.userData = { src: src.uuid, role: pbrOf(material)?.role, ...extra };
    const itemId = itemIdOf(src);
    if (itemId) mesh.userData.itemId = itemId;
    scene.add(mesh);
    meshCount++;
    triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    return mesh;
  };

  // ---- geometry per target -------------------------------------------------
  // one canonical copy per source geometry (+ group range), shared by every
  // mesh using it; flatShading needs no expansion (the path tracer shades
  // face normals natively)
  const pathtracerGeometry = (src: THREE.BufferGeometry, part: Part): THREE.BufferGeometry | null => {
    const key = `${src.uuid}|${part.range ? `${part.range.start}:${part.range.count}` : '*'}`;
    if (shared.has(key)) return shared.get(key)!;
    let g: THREE.BufferGeometry | null;
    if (!part.range && isNormalized(src)) {
      g = src; // already canonical: share the live buffers, never dispose
    } else {
      g = timed(() => normalizeGeometry(src, { range: part.range }));
      if (g) owned.add(g);
    }
    shared.set(key, g);
    return g;
  };

  const gltfGeometry = (src: THREE.BufferGeometry, part: Part, world: THREE.Matrix4, mat: THREE.MeshStandardMaterial): THREE.BufferGeometry | null => {
    const g = timed(() => normalizeGeometry(src, { range: part.range, matrix: world, flat: mat.flatShading, color: mat.vertexColors }));
    if (g) owned.add(g);
    return g;
  };

  // ---- meshes ----------------------------------------------------------------
  const emitMesh = (mesh: THREE.Mesh): void => {
    const parts = drawParts(mesh.geometry, mesh.material);
    for (const part of parts) {
      if (!part.material.visible || !isConvertible(part.material)) continue;
      const mat = mats.get(part.material)!;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        emitInstanced(mesh as THREE.InstancedMesh, part, mat);
        continue;
      }
      if (target === 'pathtracer') {
        const g = pathtracerGeometry(mesh.geometry, part);
        if (g) addMesh(g, mat, mesh, mesh.matrixWorld);
      } else {
        const g = gltfGeometry(mesh.geometry, part, mesh.matrixWorld, mat);
        if (g) addMesh(g, mat, mesh, null);
      }
    }
  };

  const emitInstanced = (im: THREE.InstancedMesh, part: Part, mat: THREE.MeshStandardMaterial): void => {
    const withColor = target === 'pathtracer' || mat.vertexColors || !!im.instanceColor;
    const key = `${im.geometry.uuid}|${part.range ? `${part.range.start}:${part.range.count}` : '*'}|${withColor}`;
    let base = baseCache.get(key);
    if (base === undefined) {
      base = timed(() => normalizeGeometry(im.geometry, { range: part.range, color: withColor }));
      baseCache.set(key, base);
    }
    if (!base) return;
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const mi = new THREE.Matrix4();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mi);
      matrices.push(new THREE.Matrix4().multiplyMatrices(im.matrixWorld, mi));
      if (im.instanceColor) {
        const c = new THREE.Color();
        im.getColorAt(i, c);
        colors.push(c);
      }
    }
    if (!matrices.length) return;
    let g = timed(() => mergeTransformed(base!, matrices, im.instanceColor ? colors : null));
    if (target === 'gltf' && mat.flatShading) {
      const flat = normalizeGeometry(g, { flat: true, color: withColor });
      g.dispose();
      if (!flat) return;
      g = flat;
    }
    owned.add(g);
    const m = im.instanceColor ? mats.get(part.material, { vertexColors: true })! : mat;
    addMesh(g, m, im, null, { instances: matrices.length });
  };

  // ---- traversal ---------------------------------------------------------------
  const tSnap = performance.now();
  const snaps = clothMgr.snapshot();
  const liveCloth = new Set<THREE.Object3D>(snaps.map((s) => s.source));
  const tWalk = performance.now();
  walkRenderMeshes(host, includeRoof, emitMesh, liveCloth);
  const tCloth = performance.now();

  // ---- cloth snapshot -----------------------------------------------------
  let clothLive = 0;
  let clothSnap = 0;
  let clothOut = 0;
  for (const s of snaps) {
    clothLive += s.source.geometry.getAttribute('position').count;
    clothSnap += s.geometry.getAttribute('position').count;
    const mat = mats.get(s.material);
    if (!mat) {
      s.geometry.dispose();
      continue;
    }
    // snapshot geometry is already world meters
    const g = normalizeGeometry(s.geometry, { color: target === 'pathtracer' || mat.vertexColors, flat: target === 'gltf' && mat.flatShading });
    s.geometry.dispose();
    if (!g) continue;
    owned.add(g);
    clothOut += g.getAttribute('position').count;
    const mesh = addMesh(g, mat, s.source, null, { cloth: s.id, settled: s.settled });
    mesh.name = `cloth:${s.id}`;
    mesh.userData.itemId = s.id;
  }

  // ---- lights ---------------------------------------------------------------
  const tLights = performance.now();
  const lights: LightDef[] = collectLights(host, { target, includeRoof, sky: opts.sky, camera: opts.camera });
  if (target === 'pathtracer') {
    for (const l of lightObjects(lights)) {
      l.updateMatrix();
      scene.add(l);
    }
  }
  scene.updateMatrixWorld(true);
  const tEnd = performance.now();

  const materials = mats.materials();
  const textures = mats.textures();
  const untagged = [...mats.untagged];
  if (untagged.length) console.warn(`render: ${untagged.length} untagged material(s) mapped to 'generic':`, untagged.join(', '));

  let disposed = false;
  return {
    scene,
    lights,
    roles: mats.roles,
    stats: {
      triangles,
      meshes: meshCount,
      materials: materials.length,
      textures: textures.size,
      lights: lights.length,
      buildMs: Math.round((performance.now() - t0) * 10) / 10,
    },
    untagged,
    clothVerts: { live: clothLive, snapshot: clothSnap, output: clothOut },
    target,
    timings: {
      setup: Math.round(tSnap - t0),
      snapshot: Math.round(tWalk - tSnap),
      walk: Math.round(tCloth - tWalk),
      cloth: Math.round(tLights - tCloth),
      lights: Math.round(tEnd - tLights),
      geometry: Math.round(geomMs),
      normalMaps: Math.round(mats.normalMapMs),
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const g of owned) g.dispose();
      for (const g of baseCache.values()) g?.dispose();
      owned.clear();
      shared.clear();
      baseCache.clear();
      mats.dispose(); // cloned materials + generated normal maps only
      scene.clear();
    },
  };
}

function itemIdOf(obj: THREE.Object3D): string | undefined {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (typeof o.userData.itemId === 'string') return o.userData.itemId as string;
    o = o.parent;
  }
  return undefined;
}

function isDescendant(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let p = o.parent;
  while (p) {
    if (p === root) return true;
    p = p.parent;
  }
  return false;
}

/** The builder's source filter, shared with QA audits: calls `onMesh` for
 * every mesh that belongs in a render (before material checks).
 * - venueGroup / exteriorGroup / itemsGroup, then role-tagged meshes hung
 *   directly on the scene root; never overlayGroup or anything in `skip`
 * - roof follows `includeRoof`; everything else its own visibility
 *   (lod 'render' forces in, lod 'live' / exclude drop the subtree)
 * - lights, cameras, helpers, lines, points, sprites, skinned meshes out
 * - under itemsGroup only meshes carrying an itemId (drops selection plates) */
export function walkRenderMeshes(
  host: SceneHost,
  includeRoof: boolean,
  onMesh: (mesh: THREE.Mesh) => void,
  skip: Set<THREE.Object3D> = new Set(),
): void {
  type Ctx = { items: boolean; itemId?: string; taggedOnly: boolean };
  const visit = (o: THREE.Object3D, ctx: Ctx): void => {
    if (o === host.overlayGroup || skip.has(o)) return;
    const rt = renderTagOf(o);
    if (rt?.exclude || rt?.lod === 'live') return;
    const vis = o === host.roof ? includeRoof : o.visible || rt?.lod === 'render';
    if (!vis) return;
    if ((o as THREE.Light).isLight) return; // lightsCollect handles lights
    if (o.type.endsWith('Helper') || (o as THREE.Camera).isCamera) return;
    if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) return;
    const itemId = typeof o.userData.itemId === 'string' ? (o.userData.itemId as string) : ctx.itemId;
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const keep =
        !(mesh as THREE.SkinnedMesh).isSkinnedMesh &&
        !!mesh.geometry?.getAttribute('position') &&
        (!ctx.items || !!itemId) && // items: drop selection plates (no itemId)
        (!ctx.taggedOnly || list.every((m) => !!m && !!pbrOf(m)));
      if (keep) onMesh(mesh);
    }
    const next: Ctx = { ...ctx, itemId };
    for (const c of o.children) visit(c, next);
  };
  host.scene.updateMatrixWorld(true);
  host.roof.updateMatrixWorld(true);
  visit(host.venueGroup, { items: false, taggedOnly: false });
  visit(host.exteriorGroup, { items: false, taggedOnly: false });
  visit(host.itemsGroup, { items: true, taggedOnly: false });
  const roofInGroups = [host.venueGroup, host.exteriorGroup, host.itemsGroup].some((g) => isDescendant(host.roof, g));
  if (!roofInGroups) visit(host.roof, { items: false, taggedOnly: false });
  // role-tagged surfaces hung straight on the scene root (lawn, backplates)
  const covered = new Set<THREE.Object3D>([host.venueGroup, host.exteriorGroup, host.itemsGroup, host.overlayGroup, host.roof]);
  for (const c of host.scene.children) {
    if (!covered.has(c)) visit(c, { items: false, taggedOnly: true });
  }
}
