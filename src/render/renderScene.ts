import * as THREE from 'three';
import type { ClothManager } from '../cloth';
import type { SceneHost } from '../scene/scene';
import type { SkyState } from '../sky/types';
import { pbrOf, renderTagOf } from './tags';
import type { LightDef, PbrTag, RenderSceneOptions, RenderSceneResult } from './types';

/** Interim render-scene builder (glTF target only) until the full builder
 * lands: flattens every visible venue/exterior/item mesh into one scene,
 * expands instancing, collects the lights. The full builder adds the
 * path-tracer target, material upgrades and attribute normalization. */
export function buildRenderScene(
  host: SceneHost,
  _clothMgr: ClothManager,
  opts: RenderSceneOptions & { sky: SkyState },
): RenderSceneResult {
  if (opts.target !== 'gltf') throw new Error('path tracer target: render-scene builder not available yet');
  const t0 = performance.now();
  const out = new THREE.Scene();
  const roles: Record<string, PbrTag> = {};
  const lights: LightDef[] = [];
  const mats = new Set<THREE.Material>();
  let triangles = 0;
  let meshes = 0;

  const roofWas = host.roof.visible;
  const overlaysWas = host.overlayGroup.visible;
  host.roof.visible = opts.includeRoof;
  host.overlayGroup.visible = false;
  host.scene.updateMatrixWorld(true);

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], matrix: THREE.Matrix4): void => {
    if (Array.isArray(material)) return;
    const m = material as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshBasicMaterial?: boolean };
    const tag = pbrOf(m);
    // MeshBasic is UI (selection plates, helpers) unless it is a tagged backplate
    if (m.isMeshBasicMaterial && tag?.role !== 'backplate') return;
    if (!m.isMeshStandardMaterial && !m.isMeshBasicMaterial) return;
    const mesh = new THREE.Mesh(geometry, m);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.name = m.name || 'mesh';
    out.add(mesh);
    meshes++;
    const idx = geometry.index;
    triangles += Math.round((idx ? idx.count : geometry.getAttribute('position').count) / 3);
    if (tag) roles[m.name] = tag;
    mats.add(m);
  };

  const lightDef = (l: THREE.PointLight | THREE.SpotLight, id: string): LightDef => {
    const p = new THREE.Vector3();
    l.getWorldPosition(p);
    const spot = (l as THREE.SpotLight).isSpotLight;
    let direction: [number, number, number] | undefined;
    if (spot) {
      const t = new THREE.Vector3();
      (l as THREE.SpotLight).target.getWorldPosition(t);
      const d = t.sub(p).normalize();
      direction = [d.x, d.y, d.z];
    }
    const decor = !!l.userData.itemId;
    return {
      id,
      kind: spot ? 'spot' : 'point',
      group: decor ? 'decor' : 'interior',
      position: [p.x, p.y, p.z],
      direction,
      colorLinear: [l.color.r, l.color.g, l.color.b],
      intensityCd: l.intensity,
      halfAngleDeg: spot ? THREE.MathUtils.radToDeg((l as THREE.SpotLight).angle) : undefined,
      penumbra: spot ? (l as THREE.SpotLight).penumbra : undefined,
      radiusM: decor ? 0.01 : 0.02,
      shadowlessEmitter: decor ? 'emitter-flame__flame' : undefined,
      ptMode: 'light',
    };
  };

  const tmp = new THREE.Matrix4();
  let n = 0;
  host.scene.traverseVisible((o) => {
    if (renderTagOf(o)?.exclude) return;
    const any = o as THREE.Object3D & {
      isLine?: boolean;
      isPoints?: boolean;
      isSprite?: boolean;
      isMesh?: boolean;
      isInstancedMesh?: boolean;
      isPointLight?: boolean;
      isSpotLight?: boolean;
      instanceMatrix?: THREE.InstancedBufferAttribute;
      count?: number;
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (any.isLine || any.isPoints || any.isSprite) return;
    if (any.isInstancedMesh && any.instanceMatrix && any.geometry && any.material) {
      for (let i = 0; i < (any.count ?? 0); i++) {
        tmp.fromArray(any.instanceMatrix.array as ArrayLike<number>, i * 16);
        add(any.geometry, any.material, o.matrixWorld.clone().multiply(tmp));
      }
      return;
    }
    if (any.isMesh && any.geometry && any.material) add(any.geometry, any.material, o.matrixWorld);
    if ((any.isPointLight || any.isSpotLight) && (o as THREE.Light).intensity > 0) {
      lights.push(lightDef(o as THREE.PointLight | THREE.SpotLight, `${any.isSpotLight ? 'spot' : 'point'}${n++}`));
    }
  });

  host.roof.visible = roofWas;
  host.overlayGroup.visible = overlaysWas;

  return {
    scene: out,
    lights,
    roles,
    stats: { triangles, meshes, materials: mats.size, textures: 0, lights: lights.length, buildMs: performance.now() - t0 },
    dispose() {
      out.clear(); // nothing was cloned — the live scene keeps its geometry
    },
  };
}
