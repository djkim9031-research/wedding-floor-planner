import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ClothManager } from '../cloth';
import type { SceneHost } from '../scene/scene';
import type { SkyState } from '../sky/types';
import { attributeSignature } from './geometryNormalize';
import { capForPathTracer } from './lightsCollect';
import { horizonLuminance, PbrMaterialCache } from './materialsPbr';
import { buildRenderScene } from './renderScene';
import { excludeFromRender, tag } from './tags';
import type { LightDef } from './types';

function sky(sunLux = 80000): SkyState {
  const w = 8;
  const h = 8;
  const data = new Float32Array(w * h * 4).fill(1000);
  return {
    input: { enabled: true, date: '2026-09-20', minutes: 990, cloudPct: 0, evComp: 0, autoEV: false },
    phase: 'day',
    sun: { altDeg: 30, azTrueDeg: 240, azModelDeg: 240, dir: [0.5, 0.5, 0.707], ridgeVisibility: 1, illuminanceLux: sunLux, colorLinear: [1, 0.9, 0.8], angularDiameterDeg: 0.545 },
    moon: { altDeg: -10, azModelDeg: 0, dir: [0, -1, 0], fraction: 0.5, brightLimbDeg: 0, illuminanceLux: 0, colorLinear: [1, 1, 1] },
    env: { w, h, data },
    bg: { w, h, data },
    skyHorizontalLux: 10000,
    ev100: 14,
    version: 1,
  };
}

function fakeHost() {
  const scene = new THREE.Scene();
  const venueGroup = new THREE.Group();
  const exteriorGroup = new THREE.Group();
  const itemsGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  const roof = new THREE.Group();
  venueGroup.add(roof);
  scene.add(venueGroup, exteriorGroup, itemsGroup, overlayGroup);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 10);
  const host = { scene, venueGroup, exteriorGroup, itemsGroup, overlayGroup, roof, getCamera: () => camera } as unknown as SceneHost;
  return { host, scene, venueGroup, exteriorGroup, itemsGroup, overlayGroup, roof, camera };
}

const noCloth = { snapshot: () => [] } as unknown as ClothManager;

describe('PbrMaterialCache', () => {
  it('shares one output material per source material', () => {
    const cache = new PbrMaterialCache({ horizonLuminance: 1000 });
    const a = tag(new THREE.MeshStandardMaterial({ color: 0xff0000 }), 'paint-wall', {}, 'a');
    const b = tag(new THREE.MeshStandardMaterial({ color: 0x00ff00 }), 'paint-wall', {}, 'b');
    expect(cache.get(a)).toBe(cache.get(a));
    expect(cache.get(a)).not.toBe(cache.get(b));
    expect(cache.get(a)).not.toBe(a); // always a clone
    expect(cache.materials().length).toBe(2);
    expect(cache.get(new THREE.MeshBasicMaterial())).toBeNull();
  });

  it('maps roles to physical parameters', () => {
    const cache = new PbrMaterialCache({ horizonLuminance: 1234 });
    const glass = cache.get(tag(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1 }), 'glass-clear', { thin: true }, 'win'))! as THREE.MeshPhysicalMaterial;
    expect(glass.isMeshPhysicalMaterial).toBe(true);
    expect([glass.transmission, glass.ior, glass.thickness, glass.roughness, glass.transparent, glass.opacity]).toEqual([1, 1.5, 0, 0.02, false, 1]);
    const ware = cache.get(tag(new THREE.MeshPhysicalMaterial({ roughness: 0.05 }), 'glass-tableware', {}, 'ware'))! as THREE.MeshPhysicalMaterial;
    expect(ware.thickness).toBeCloseTo(0.003);
    expect(ware.attenuationDistance).toBe(Infinity);
    const linen = cache.get(tag(new THREE.MeshStandardMaterial(), 'linen', { sheen: 0.6, sheenRoughness: 0.65 }, 'lin'))! as THREE.MeshPhysicalMaterial;
    expect([linen.sheen, linen.sheenRoughness, linen.roughness]).toEqual([0.6, 0.65, 0.85]);
    const floor = cache.get(tag(new THREE.MeshStandardMaterial(), 'wood-floor', { clearcoat: 0.35, clearcoatRoughness: 0.2 }, 'fl'))! as THREE.MeshPhysicalMaterial;
    expect([floor.clearcoat, floor.clearcoatRoughness]).toEqual([0.35, 0.2]);
    const leaf = cache.get(tag(new THREE.MeshStandardMaterial({ emissive: 0x223311, emissiveIntensity: 0.4 }), 'foliage', {}, 'leaf'))!;
    expect(leaf.emissiveIntensity).toBe(0);
    expect(leaf.side).toBe(THREE.DoubleSide);
    const flame = cache.get(tag(new THREE.MeshStandardMaterial({ emissive: 0xffa63c }), 'emitter-flame', { luminance: 8000, castShadow: false }, 'flame'))!;
    const e = flame.emissive;
    expect((0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b) * flame.emissiveIntensity).toBeCloseTo(8000, 0);
    expect((flame as unknown as { castShadow: boolean }).castShadow).toBe(false);
    expect(flame.name).toBe('emitter-flame__flame');
    expect(cache.roles['emitter-flame__flame'].luminance).toBe(8000);
  });

  it('turns MeshBasic backplates into black emitters scaled by the horizon', () => {
    const cache = new PbrMaterialCache({ horizonLuminance: 1234 });
    const map = new THREE.Texture();
    const src = tag(new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.35, side: THREE.BackSide }), 'backplate', { cameraOnly: true, castShadow: false }, 'pano');
    const m = cache.get(src)!;
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.color.getHex()).toBe(0);
    expect(m.emissiveMap).toBe(map);
    expect(m.map).toBe(map);
    expect(m.emissiveIntensity).toBe(1234);
    expect([m.alphaTest, m.transparent, m.side]).toEqual([0.35, true, THREE.BackSide]);
    expect((m as unknown as { castShadow: boolean }).castShadow).toBe(false);
  });

  it('horizonLuminance averages the rows just above the horizon', () => {
    const s = sky();
    expect(horizonLuminance(s)).toBeCloseTo(1000, 3);
  });
});

describe('buildRenderScene', () => {
  it('flattens, filters, expands instances and normalizes attributes', () => {
    const h = fakeHost();
    const wall = tag(new THREE.MeshStandardMaterial(), 'paint-wall', {}, 'wall');
    const box = new THREE.BoxGeometry(1, 1, 1);
    const nested = new THREE.Group();
    nested.position.set(3, 0, 0);
    nested.add(new THREE.Mesh(box, wall), new THREE.Mesh(box, wall));
    h.venueGroup.add(nested);
    h.venueGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial()));
    h.venueGroup.add(excludeFromRender(new THREE.Mesh(box, wall)));
    const hidden = new THREE.Mesh(box, wall);
    hidden.visible = false;
    h.venueGroup.add(hidden);
    // roof (hidden live) with an instanced rafter set
    h.roof.visible = false;
    const rafters = new THREE.InstancedMesh(box, wall, 5);
    for (let i = 0; i < 5; i++) rafters.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 4, 0));
    h.roof.add(rafters);
    // items: a chair (itemId) + a selection plate (no itemId) + a lantern light
    const chair = new THREE.Group();
    chair.userData.itemId = 'c1';
    const seat = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), tag(new THREE.MeshStandardMaterial(), 'wood-table', {}, 'oak'));
    seat.userData.itemId = 'c1';
    const light = new THREE.PointLight(0xffaa55, 3, 4, 2);
    light.userData.itemId = 'c1';
    chair.add(seat, light);
    h.itemsGroup.add(chair, new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
    h.overlayGroup.add(new THREE.Mesh(box, wall));
    // scene-root: tagged backplate kept, untagged sky + helper dropped
    h.scene.add(new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 10, 16, 1, true), tag(new THREE.MeshBasicMaterial({ map: new THREE.Texture() }), 'backplate', { cameraOnly: true }, 'pano')));
    h.scene.add(new THREE.Mesh(new THREE.SphereGeometry(100), new THREE.MeshBasicMaterial()));
    h.scene.add(new THREE.AxesHelper());

    const noRoof = buildRenderScene(h.host, noCloth, { target: 'pathtracer', includeRoof: false, sky: sky() });
    const withRoof = buildRenderScene(h.host, noCloth, { target: 'pathtracer', includeRoof: true, sky: sky() });
    const meshes = (r: typeof noRoof) => r.scene.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    // 2 nested boxes + chair seat + backplate
    expect(meshes(noRoof).length).toBe(4);
    expect(meshes(withRoof).length).toBe(5);
    const inst = meshes(withRoof).find((m) => m.userData.instances)!;
    expect(inst.userData.instances).toBe(5);
    expect(inst.geometry.getAttribute('position').count).toBe(5 * 24);
    for (const r of [noRoof, withRoof]) {
      for (const c of r.scene.children) {
        expect(c.children.length).toBe(0); // flat
        expect((c as THREE.InstancedMesh).isInstancedMesh).toBeFalsy();
        if ((c as THREE.Mesh).isMesh) expect(((c as THREE.Mesh).material as THREE.Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial).toBe(true);
      }
      expect(new Set(meshes(r).map((m) => attributeSignature(m.geometry))).size).toBe(1);
    }
    // the two nested boxes share geometry + material; world transform kept on the mesh
    const [b1, b2] = meshes(noRoof).filter((m) => (m.material as THREE.Material).name === 'paint-wall__wall');
    expect(b1.geometry).toBe(b2.geometry);
    expect(b1.material).toBe(b2.material);
    expect(b1.matrixWorld.elements[12]).toBeCloseTo(3);
    // lights: sun + lantern point light, both as THREE lights for the PT
    expect(noRoof.lights.map((l) => l.id)).toEqual(['sun', 'c1:light']);
    expect(noRoof.lights[1].group).toBe('decor');
    expect(noRoof.lights[1].radiusM).toBeCloseTo(0.01);
    const ptLights = noRoof.scene.children.filter((c) => (c as THREE.Light).isLight) as THREE.Light[];
    expect(ptLights.length).toBe(2);
    const pl = ptLights.find((l) => (l as THREE.PointLight).isPointLight) as THREE.PointLight;
    expect([pl.distance, pl.decay, pl.intensity]).toEqual([0, 2, 3]);
    const sun = ptLights.find((l) => (l as THREE.DirectionalLight).isDirectionalLight)!;
    expect(sun.intensity).toBe(80000);
    expect(noRoof.stats.meshes).toBe(4);
    expect(noRoof.stats.triangles).toBeGreaterThan(0);
    expect(noRoof.stats.lights).toBe(2);
    noRoof.dispose();
    withRoof.dispose();
  });

  it('gltf target bakes world transforms and adds no light objects', () => {
    const h = fakeHost();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tag(new THREE.MeshStandardMaterial({ flatShading: true }), 'stone', {}, 'st'));
    m.position.set(0, 0, 7);
    h.exteriorGroup.add(m);
    const r = buildRenderScene(h.host, noCloth, { target: 'gltf', includeRoof: false, sky: sky() });
    const out = r.scene.children[0] as THREE.Mesh;
    expect(r.scene.children.length).toBe(1);
    expect(out.matrixWorld.equals(new THREE.Matrix4())).toBe(true);
    const p = out.geometry.getAttribute('position');
    expect(p.count).toBe(36); // flat: independent triangles
    expect(p.getZ(0)).toBeGreaterThan(6);
    expect(out.geometry.getAttribute('color')).toBeUndefined(); // no vertex colors in use
    expect(r.lights.length).toBe(1);
    r.dispose();
  });

  it('uses the cloth snapshot instead of the live cloth mesh', () => {
    const h = fakeHost();
    const clothGroup = new THREE.Group();
    clothGroup.scale.setScalar(0.0254);
    h.itemsGroup.add(clothGroup);
    const mat = tag(new THREE.MeshPhysicalMaterial({ vertexColors: true }), 'linen', { sheen: 0.6 }, 'cloth');
    const geo = new THREE.PlaneGeometry(100, 100, 4, 4);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(25 * 3).fill(1), 3));
    const live = new THREE.Mesh(geo, mat);
    live.userData.itemId = 'k1';
    clothGroup.add(live);
    h.scene.updateMatrixWorld(true);
    const snapGeo = geo.clone().applyMatrix4(live.matrixWorld);
    const cloth = { snapshot: () => [{ id: 'k1', geometry: snapGeo, material: mat, settled: true, source: live }] } as unknown as ClothManager;
    const r = buildRenderScene(h.host, cloth, { target: 'pathtracer', includeRoof: false, sky: sky() });
    const meshes = r.scene.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    expect(meshes.length).toBe(1);
    expect(meshes[0].name).toBe('cloth:k1');
    expect(r.clothVerts).toEqual({ live: 25, snapshot: 25, output: 25 });
    const p = meshes[0].geometry.getAttribute('position');
    expect(Math.abs(p.getX(0))).toBeCloseTo(50 * 0.0254, 4); // meters
    expect(meshes[0].geometry.getAttribute('color').itemSize).toBe(4);
    r.dispose();
  });
});

describe('capForPathTracer', () => {
  it('keeps directional lights and the most important locals', () => {
    const defs: LightDef[] = [{ id: 'sun', kind: 'directional', group: 'sky', position: [0, 0, 0], colorLinear: [1, 1, 1], illuminanceLux: 1e5, ptMode: 'light' }];
    for (let i = 0; i < 30; i++) defs.push({ id: `p${i}`, kind: 'point', group: 'decor', position: [i, 0, 0], colorLinear: [1, 1, 1], intensityCd: 10, ptMode: 'light' });
    const cam = new THREE.PerspectiveCamera();
    cam.updateMatrixWorld();
    capForPathTracer(defs, cam, 24);
    expect(defs.filter((d) => d.ptMode === 'light').length).toBe(24);
    expect(defs[0].ptMode).toBe('light');
    expect(defs.find((d) => d.id === 'p0')!.ptMode).toBe('light');
    expect(defs.find((d) => d.id === 'p29')!.ptMode).toBe('emitter-only');
  });

  it('omits a negligible daytime moon', () => {
    const defs: LightDef[] = [
      { id: 'sun', kind: 'directional', group: 'sky', position: [0, 0, 0], colorLinear: [1, 1, 1], illuminanceLux: 7e4, ptMode: 'light' },
      { id: 'moon', kind: 'directional', group: 'sky', position: [0, 0, 0], colorLinear: [1, 1, 1], illuminanceLux: 0.01, ptMode: 'light' },
    ];
    capForPathTracer(defs, null);
    expect(defs.map((d) => d.ptMode)).toEqual(['light', 'omit']);
    const night: LightDef[] = [{ ...defs[1], ptMode: 'light' }];
    capForPathTracer(night, null);
    expect(night[0].ptMode).toBe('light');
  });
});
