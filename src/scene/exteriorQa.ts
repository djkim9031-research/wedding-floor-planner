import * as THREE from 'three';
import { qaReport, registerQaHook } from '../app/qaHooks';
import { i2m } from '../constants';
import { backdropTimings } from './texturesExterior';
import type { ObjectRenderTag } from '../render/types';

/** Stand-here cameras matched (roughly) to the reference photos in
 * reference/quad/: position in inches, yaw 0 = model −z (positive turns
 * toward −x), pitch up positive, eye height inches, vertical FOV (the
 * iPhone main camera in 4:3 is ≈53°). */
export const REF_CAMS: Record<string, { x: number; z: number; yaw: number; pitch: number; eye: number; fov: number }> = {
  // 01 — by the NW chamfer rail, looking NE along it over the lot
  '1': { x: -100, z: -330, yaw: -30, pitch: -2, eye: 62, fov: 53.1 },
  // 03 — from the covered bay looking N with the leaning trunk at right
  '3': { x: 150, z: -60, yaw: -12, pitch: 1, eye: 60, fov: 53.1 },
  // 04 — a few steps east, trunks at right, trailer beyond the rail
  '4': { x: 300, z: -100, yaw: 0, pitch: -1.5, eye: 60, fov: 53.1 },
};

function triCount(o: THREE.Object3D): number {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return 0;
  const g = m.geometry;
  const n = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
  const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
  return n * inst;
}

/** Triangle budget of a subtree: what the live view draws vs what a render
 * (path tracer / Blender) would include per the lod tags. */
export function lodTriangles(root: THREE.Object3D): { live: number; render: number; renderOnly: number; liveOnly: number } {
  let live = 0;
  let render = 0;
  let renderOnly = 0;
  let liveOnly = 0;
  const walk = (o: THREE.Object3D, parentVisible: boolean) => {
    const tagR = o.userData.render as ObjectRenderTag | undefined;
    const lod = tagR?.lod;
    const t = triCount(o);
    const vis = parentVisible && o.visible;
    if (!tagR?.exclude) {
      if (lod === 'render') {
        render += t;
        renderOnly += t;
      } else if (lod === 'live') {
        if (vis) live += t;
        liveOnly += t;
      } else {
        if (vis) live += t;
        if (parentVisible || o.visible) render += t;
      }
    }
    for (const c of o.children) walk(c, vis || lod === 'render');
  };
  walk(root, true);
  return { live, render, renderOnly, liveOnly };
}

registerQaHook((ctx, params) => {
  const ref = params.get('ref');
  const refcam = params.get('refcam');
  let cam: (typeof REF_CAMS)[string] | null = ref ? (REF_CAMS[ref] ?? null) : null;
  if (refcam) {
    const [x, z, yaw, pitch, eye, fov] = refcam.split(',').map(Number);
    cam = { x, z, yaw, pitch, eye: eye || 60, fov: fov || 53.1 };
  }
  if (cam) {
    ctx.rig.enterStandAt({ x: cam.x, z: cam.z }, cam.yaw, cam.pitch, cam.eye);
    ctx.rig.camera.fov = cam.fov;
    ctx.rig.camera.updateProjectionMatrix();
    ctx.host.invalidate();
  }
  if (params.get('topdeck') === '1') {
    // plan view centred on the Tree Deck (the canopy dissolves from above)
    ctx.rig.camera.position.set(i2m(280), 19, i2m(-175) + 19 * Math.tan(0.06));
    ctx.rig.controls.target.set(i2m(280), 0, i2m(-175));
    ctx.rig.camera.lookAt(ctx.rig.controls.target);
    ctx.host.invalidate();
  }
  if (params.get('clean') === '1') {
    for (const el of Array.from(ctx.root.children)) {
      if (el !== ctx.host.canvas) (el as HTMLElement).style.display = 'none';
    }
  }
  const texName = params.get('tex');
  if (texName) {
    // inspect a generated texture: #tex=<material name>[,<map slot>]
    const [matName, slot = 'map'] = texName.split(',');
    let img: CanvasImageSource | null = null;
    ctx.host.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!img && m && !Array.isArray(m) && m.name === matName) {
        const t = (m as unknown as Record<string, THREE.Texture | undefined>)[slot];
        const src = t?.image as { data?: Uint8Array; width: number; height: number } | HTMLCanvasElement | undefined;
        if (src instanceof HTMLCanvasElement) img = src;
        else if (src?.data) {
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const id = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
          c.getContext('2d')!.putImageData(id, 0, 0);
          img = c;
        }
      }
    });
    if (img) {
      const view = document.createElement('canvas');
      const w = window.innerWidth;
      const src = img as HTMLCanvasElement;
      view.width = w;
      view.height = Math.round((src.height * w) / src.width);
      const g = view.getContext('2d')!;
      g.fillStyle = '#9fb7d6'; // a stand-in sky so transparent texels show
      g.fillRect(0, 0, view.width, view.height);
      g.drawImage(src, 0, 0, view.width, view.height);
      view.style.cssText = 'position:fixed;left:0;top:0;z-index:1000';
      document.body.appendChild(view);
    }
  }
  if (params.get('lod') === 'render') {
    // preview the render LOD in the raster view
    ctx.host.scene.traverse((o) => {
      const lod = (o.userData.render as ObjectRenderTag | undefined)?.lod;
      if (lod === 'render') o.visible = true;
      else if (lod === 'live') o.visible = false;
    });
    ctx.host.invalidateShadows();
  }
  if (params.get('qa') === 'stats' || cam) {
    let frames = 0;
    const off = ctx.host.onFrame(() => {
      if (++frames < 4) return true;
      off();
      const info = ctx.host.renderer.info;
      const scene = lodTriangles(ctx.host.scene);
      const ext = lodTriangles(ctx.host.exteriorGroup);
      const byGroup: Record<string, { live: number; render: number }> = {};
      for (const c of ctx.host.exteriorGroup.children) {
        const t = lodTriangles(c);
        const key = c.name || c.type;
        byGroup[key] = { live: (byGroup[key]?.live ?? 0) + t.live, render: (byGroup[key]?.render ?? 0) + t.render };
      }
      const report = {
        frameTriangles: info.render.triangles,
        drawCalls: info.render.calls,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        sceneLive: scene.live,
        sceneRender: scene.render,
        exteriorLive: ext.live,
        exteriorRender: ext.render,
        exteriorRenderOnly: ext.renderOnly,
        exteriorLiveOnly: ext.liveOnly,
        byGroup,
        deckOak: ctx.host.exteriorGroup.userData.deckOakStats,
        deckPucks: ctx.host.exteriorGroup.userData.deckPucks,
        exteriorBuildMs: ctx.host.exteriorGroup.userData.buildMs,
        backdropMs: backdropTimings,
      };
      qaReport('exterior', report);
      console.info('[exteriorQa]', JSON.stringify(report));
      return true;
    });
  }
});
