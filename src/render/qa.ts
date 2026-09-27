import * as THREE from 'three';
import { settleCloth, type AppContext } from '../app/context';
import { qaReport, registerQaHook } from '../app/qaHooks';
import { exposureScale } from '../sky/exposure';
import { getSky } from '../sky/skyStore';
import type { EquirectImage, SkyState } from '../sky/types';
import { attributeSignature } from './geometryNormalize';
import { buildRenderScene, walkRenderMeshes, type BuiltRenderScene } from './renderScene';
import { pbrOf } from './tags';
import type { RenderSceneOptions } from './types';

/** Headless QA for the render-scene builder.
 *   #qa=renderscene&target=pathtracer|gltf[&includeRoof=1]
 *       build after the drapes settle, report stats + invariants to
 *       window.__wpQA.renderscene, then raster-draw the BUILT scene into the
 *       main canvas (sky env PMREM, photometric exposure) for the screenshot
 *   #qa=roles      every render material's name + role (console.error per
 *                  untagged mesh material)
 *   #qa=ptsmoke    real three-gpu-pathtracer on the built scene: setScene
 *                  (BVH) ms, compile, ~4 samples at 320×180, non-black check */

/** Float equirect sky (cd/m², rows bottom-up) as a three texture. */
export function equirectTexture(img: EquirectImage): THREE.DataTexture {
  const t = new THREE.DataTexture(img.data, img.w, img.h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export interface RenderSceneAudit {
  /** objects that must never reach a render scene (nested nodes, lines,
   * points, sprites, instanced/skinned meshes, non-PBR materials) */
  forbidden: number;
  allStandard: boolean;
  /** unique attribute signatures across output meshes */
  attrKeys: string[];
  /** non-finite attribute values + out-of-range indices */
  nanCount: number;
  lightsByMode: Record<string, number>;
  materialsByRole: Record<string, number>;
}

export function auditRenderScene(built: BuiltRenderScene): RenderSceneAudit {
  let forbidden = 0;
  let allStandard = true;
  let nanCount = 0;
  const sigs = new Set<string>();
  const checked = new Set<THREE.BufferGeometry>();
  built.scene.traverse((o) => {
    if (o === built.scene) return;
    if (o.parent !== built.scene) forbidden++;
    if (
      (o as THREE.Line).isLine ||
      (o as THREE.Points).isPoints ||
      (o as THREE.Sprite).isSprite ||
      (o as THREE.InstancedMesh).isInstancedMesh ||
      (o as THREE.SkinnedMesh).isSkinnedMesh ||
      o.type.endsWith('Helper')
    )
      forbidden++;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      forbidden++;
      allStandard = false;
    }
    sigs.add(attributeSignature(mesh.geometry));
    if (checked.has(mesh.geometry)) return;
    checked.add(mesh.geometry);
    for (const a of Object.values(mesh.geometry.attributes)) {
      const arr = a.array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) nanCount++;
    }
    const idx = mesh.geometry.index;
    const n = mesh.geometry.getAttribute('position').count;
    if (idx) {
      const arr = idx.array;
      for (let i = 0; i < arr.length; i++) if (arr[i] >= n) nanCount++;
    }
  });
  const lightsByMode: Record<string, number> = {};
  for (const l of built.lights) lightsByMode[l.ptMode] = (lightsByMode[l.ptMode] ?? 0) + 1;
  const materialsByRole: Record<string, number> = {};
  for (const t of Object.values(built.roles)) materialsByRole[t.role] = (materialsByRole[t.role] ?? 0) + 1;
  return { forbidden, allStandard, attrKeys: [...sigs], nanCount, lightsByMode, materialsByRole };
}

/** Raster-draw a built scene in place of the live one (QA screenshot / the
 * photo-mode "moving" fallback): sky PMREM environment + background,
 * photometric exposure. Returns a restore function. */
export function showRenderSceneRaster(ctx: AppContext, built: BuiltRenderScene, sky: SkyState): () => void {
  const { host } = ctx;
  const renderer = host.renderer;
  const env = equirectTexture(sky.env);
  const bg = sky.bg === sky.env ? env : equirectTexture(sky.bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(env);
  pmrem.dispose();
  built.scene.environment = envRT.texture;
  built.scene.background = bg;
  const exposure = exposureScale(sky.ev100);
  host.setOverlaysVisible(false);
  host.setRenderOverride((f) => {
    if (!f.dirty && !f.camMoved) return;
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = exposure;
    renderer.render(built.scene, f.camera);
    renderer.toneMappingExposure = prev;
  });
  return () => {
    host.setRenderOverride(null);
    host.setOverlaysVisible(true);
    envRT.dispose();
    env.dispose();
    if (bg !== env) bg.dispose();
  };
}

const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

async function runRenderSceneQa(ctx: AppContext, params: URLSearchParams): Promise<void> {
  await settleCloth();
  await frames(2);
  const target: RenderSceneOptions['target'] = params.get('target') === 'gltf' ? 'gltf' : 'pathtracer';
  const includeRoof = params.get('includeRoof') === '1' || ctx.host.roofVisible();
  const sky = getSky();
  const opts = { target, includeRoof, sky, camera: ctx.host.getCamera() };
  // cold build pays one-time costs (first canvas readback, normal-map
  // bakes); the warm rebuild is what photo mode pays on re-entry
  const cold = buildRenderScene(ctx.host, ctx.clothMgr, opts);
  const coldMs = cold.stats.buildMs;
  const coldTimings = cold.timings;
  cold.dispose();
  const built = buildRenderScene(ctx.host, ctx.clothMgr, opts);
  const audit = auditRenderScene(built);
  const report = {
    target,
    includeRoof,
    ...built.stats,
    coldBuildMs: coldMs,
    coldTimings,
    timings: built.timings,
    ...audit,
    untagged: built.untagged,
    clothVerts: built.clothVerts,
    roles: Object.keys(built.roles).length,
    lightDefs: built.lights.map((l) => ({ id: l.id, kind: l.kind, group: l.group, ptMode: l.ptMode, cd: l.intensityCd, lux: l.illuminanceLux })),
    ok:
      audit.forbidden === 0 &&
      audit.allStandard &&
      audit.nanCount === 0 &&
      (target !== 'pathtracer' || audit.attrKeys.length === 1) &&
      built.stats.triangles <= 1_500_000 &&
      built.clothVerts.live === built.clothVerts.snapshot,
  };
  if (params.get('glb') === '1') {
    // exporter compatibility of the builder output (the export pipeline
    // itself lives in render/export)
    try {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const t = performance.now();
      const limit = Number(params.get('glbTimeout') ?? 300000);
      const glb = (await Promise.race([
        new GLTFExporter().parseAsync(built.scene, { binary: true, maxTextureSize: 2048 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`GLTFExporter timeout after ${limit} ms`)), limit)),
      ])) as ArrayBuffer;
      Object.assign(report, { glbBytes: glb.byteLength, glbMs: Math.round(performance.now() - t) });
    } catch (e) {
      Object.assign(report, { ok: false, glbError: String(e).slice(0, 400) });
    }
  }
  if (!report.ok) console.error('renderscene QA failed', JSON.stringify(report));
  showRenderSceneRaster(ctx, built, sky);
  (window as unknown as { __wpRenderScene?: BuiltRenderScene }).__wpRenderScene = built;
  await frames(2);
  qaReport('renderscene', report);
}

async function runRolesQa(ctx: AppContext): Promise<void> {
  await settleCloth();
  const mats = new Map<string, { m: THREE.Material; meshes: Set<string> }>();
  walkRenderMeshes(ctx.host, true, (mesh) => {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      let e = mats.get(m.uuid);
      if (!e) mats.set(m.uuid, (e = { m, meshes: new Set() }));
      e.meshes.add(mesh.name || mesh.parent?.name || mesh.type);
    }
  });
  const list = [...mats.values()].map(({ m, meshes }) => ({ name: m.name, role: pbrOf(m)?.role ?? null, type: m.type, meshes: [...meshes].slice(0, 3) }));
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const untagged = list.filter((x) => !x.role);
  for (const u of untagged) console.error(`untagged render material "${u.name || '(unnamed)'}" (${u.type}) on ${u.meshes.join(', ')}`);
  const byRole: Record<string, number> = {};
  for (const x of list) byRole[x.role ?? 'UNTAGGED'] = (byRole[x.role ?? 'UNTAGGED'] ?? 0) + 1;
  qaReport('roles', { count: list.length, byRole, untagged: untagged.length, materials: list });
}

/** Real three-gpu-pathtracer run on the built scene — validates the
 * builder's output against the library (attribute merge, BVH, textures,
 * lights) and times the steps photo mode will pay. */
async function runPtSmoke(ctx: AppContext, params: URLSearchParams): Promise<void> {
  const { host } = ctx;
  const renderer = host.renderer;
  const W = Number(params.get('w') ?? 320);
  const H = Number(params.get('h') ?? 180);
  const SPP = Number(params.get('spp') ?? 4);
  const out: Record<string, unknown> = { w: W, h: H };
  try {
    await settleCloth();
    await frames(2);
    const sky = getSky();
    const cam = host.getCamera()!.clone();
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const includeRoof = params.get('includeRoof') === '1' || host.roofVisible();
    const built = buildRenderScene(host, ctx.clothMgr, { target: 'pathtracer', includeRoof, sky, camera: cam });
    Object.assign(out, { includeRoof, ...built.stats, attrKeys: auditRenderScene(built).attrKeys.length });
    const env = equirectTexture(sky.env);
    built.scene.environment = env;
    built.scene.background = sky.bg === sky.env ? env : equirectTexture(sky.bg);

    const tImport = performance.now();
    const { WebGLPathTracer } = await import('three-gpu-pathtracer');
    out.importMs = Math.round(performance.now() - tImport);
    host.setOverlaysVisible(false);
    host.setRenderOverride(() => {}); // park the raster loop
    const pt = new WebGLPathTracer(renderer);
    pt.renderDelay = 0;
    pt.minSamples = 0;
    pt.fadeDuration = 0;
    pt.tiles.set(1, 1);
    pt.bounces = Number(params.get('bounces') ?? 4);
    pt.transmissiveBounces = 4;
    pt.rasterizeScene = false;
    pt.synchronizeRenderSize = false;
    (pt as unknown as { _pathTracer: { setSize(w: number, h: number): void } })._pathTracer.setSize(W, H);

    const t0 = performance.now();
    pt.setScene(built.scene, cam);
    out.setSceneMs = Math.round(performance.now() - t0);
    out.ptLights = built.scene.children.filter((c) => (c as THREE.Light).isLight).length;

    const exposure = exposureScale(sky.ev100);
    const tStart = performance.now();
    const timeoutMs = Number(params.get('timeout') ?? 300000);
    const px = new Float32Array(4);
    await new Promise<void>((resolve) => {
      let firstAt = 0;
      let done = false;
      host.setRenderOverride(() => {
        const prev = renderer.toneMappingExposure;
        renderer.toneMappingExposure = exposure;
        const before = pt.samples;
        pt.renderSample(); // once paused this only redraws the image
        renderer.toneMappingExposure = prev;
        if (done) return;
        // WebGL is asynchronous: a 1-pixel readback waits for the GPU so
        // the timings below are real sample times, not submission times
        if (pt.samples !== before) renderer.readRenderTargetPixels(pt.target, 0, 0, 1, 1, px);
        if (!firstAt && pt.samples >= 1) {
          firstAt = performance.now();
          out.firstSampleMs = Math.round(firstAt - tStart);
        }
        if (pt.samples >= SPP || performance.now() - tStart > timeoutMs) {
          done = true;
          pt.pausePathTracing = true; // keep showing the image, stop sampling
          out.samples = pt.samples;
          out.msPerSample = firstAt && pt.samples > 1 ? Math.round((performance.now() - firstAt) / (pt.samples - 1)) : null;
          resolve();
        }
      });
    });

    const buf = new Float32Array(W * H * 4);
    renderer.readRenderTargetPixels(pt.target, 0, 0, W, H, buf);
    let sum = 0;
    let max = 0;
    let lit = 0;
    let nan = 0;
    for (let i = 0; i < W * H; i++) {
      const r = buf[i * 4];
      const g = buf[i * 4 + 1];
      const b = buf[i * 4 + 2];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        nan++;
        continue;
      }
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += y;
      if (y > max) max = y;
      if (y > 1e-3) lit++;
    }
    Object.assign(out, {
      meanLum: +(sum / (W * H)).toFixed(3),
      maxLum: +max.toFixed(1),
      litFrac: +(lit / (W * H)).toFixed(3),
      nanPixels: nan,
      // dark interiors at a few spp leave many pixels at exactly 0; any real
      // light transport yields a positive mean and a share of lit pixels
      nonBlack: sum > 0 && lit / (W * H) > 0.05 && nan === 0,
      ev100: +sky.ev100.toFixed(2),
      totalMs: Math.round(performance.now() - t0),
    });
    if (params.get('png') === '1') out.png = previewPng(buf, W, H, exposureScale(sky.ev100));
    out.ok = out.nonBlack === true && (out.samples as number) >= SPP;
    if (!out.ok) console.error('ptsmoke QA failed', JSON.stringify(out));
  } catch (e) {
    out.ok = false;
    out.error = String((e as Error)?.stack ?? e).slice(0, 800);
    console.error('ptsmoke failed', e);
  }
  qaReport('ptsmoke', out);
}

/** Native-resolution PNG of a float HDR frame (exposure, ACES-ish fit,
 * sRGB) — lets headless runs inspect path-traced pixels unscaled. */
function previewPng(buf: Float32Array, w: number, h: number, exposure: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const tm = (x: number) => {
    const v = Math.max(x * exposure, 0);
    const a = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
    const s = Math.min(Math.max(a, 0), 1);
    return Math.round(255 * (s <= 0.0031308 ? 12.92 * s : 1.055 * Math.pow(s, 1 / 2.4) - 0.055));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4; // GL rows are bottom-up
      const o = (y * w + x) * 4;
      img.data[o] = tm(buf[i]);
      img.data[o + 1] = tm(buf[i + 1]);
      img.data[o + 2] = tm(buf[i + 2]);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

registerQaHook((ctx, params) => {
  const qa = params.get('qa');
  if (qa === 'renderscene') void runRenderSceneQa(ctx, params);
  else if (qa === 'roles') void runRolesQa(ctx);
  else if (qa === 'ptsmoke') void runPtSmoke(ctx, params);
});
