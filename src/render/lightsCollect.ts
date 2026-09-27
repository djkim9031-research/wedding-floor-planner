import * as THREE from 'three';
import type { SceneHost } from '../scene/scene';
import { cctToLinear } from '../sky/exposure';
import type { SkyState } from '../sky/types';
import { pbrOf, renderTagOf } from './tags';
import type { LightDef, LightGroup, RenderSceneOptions } from './types';

/** Light collection for render scenes (three world, meters, photometric):
 * sun / moon from the sky state (lux), every visible Point/SpotLight of the
 * live scene (candela) — fixtures and porch lights at the scene root,
 * lantern candles inside items.
 *
 * Owners can pin fields per light with `light.userData.light`
 * (Partial<LightDef>: group, cct, radiusM, ptMode, shadowlessEmitter, id). */

/** three-gpu-pathtracer samples lights uniformly — past a couple dozen,
 * each light gets too few samples; the rest stay visible as emitter meshes. */
export const PT_LIGHT_CAP = 24;

const RADIUS_LANTERN = 0.01;
const RADIUS_FIXTURE = 0.02;

export interface CollectLightsOptions extends RenderSceneOptions {
  sky: SkyState;
  camera?: THREE.Camera | null;
}

/** Visible in the render (walks ancestors; the roof follows includeRoof). */
export function renderVisible(obj: THREE.Object3D, host: SceneHost, includeRoof: boolean): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o === host.overlayGroup) return false;
    const rt = renderTagOf(o);
    if (rt?.exclude || rt?.lod === 'live') return false;
    const vis = o === host.roof ? includeRoof : o.visible || rt?.lod === 'render';
    if (!vis) return false;
    o = o.parent;
  }
  return true;
}

function itemIdOf(obj: THREE.Object3D): string | undefined {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (typeof o.userData.itemId === 'string') return o.userData.itemId as string;
    o = o.parent;
  }
  return undefined;
}

/** Flame (or other emitter) material next to a light inside the same item. */
function emitterNear(light: THREE.Light): string | undefined {
  const parent = light.parent;
  if (!parent) return undefined;
  let name: string | undefined;
  parent.traverse((o) => {
    if (name || !(o as THREE.Mesh).isMesh) return;
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      const role = pbrOf(m)?.role;
      if (role === 'emitter-flame' || role === 'emitter-led' || role === 'emitter-fixture') {
        name = m.name;
        return;
      }
    }
  });
  return name;
}

const v3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

export function collectLights(host: SceneHost, opts: CollectLightsOptions): LightDef[] {
  const defs: LightDef[] = [];
  const { sky } = opts;

  if (sky.sun.illuminanceLux > 0) {
    const d = sky.sun.dir;
    defs.push({
      id: 'sun',
      kind: 'directional',
      group: 'sky',
      position: [0, 0, 0],
      direction: [-d[0], -d[1], -d[2]],
      colorLinear: [...sky.sun.colorLinear],
      illuminanceLux: sky.sun.illuminanceLux,
      halfAngleDeg: sky.sun.angularDiameterDeg / 2,
      ptMode: 'light',
    });
  }
  if (sky.moon.altDeg > 0 && sky.moon.illuminanceLux > 0) {
    const d = sky.moon.dir;
    defs.push({
      id: 'moon',
      kind: 'directional',
      group: 'sky',
      position: [0, 0, 0],
      direction: [-d[0], -d[1], -d[2]],
      colorLinear: [...sky.moon.colorLinear],
      illuminanceLux: sky.moon.illuminanceLux,
      halfAngleDeg: 0.26,
      ptMode: 'light',
    });
  }

  host.scene.updateMatrixWorld(true);
  const seen = new Set<string>();
  const wp = new THREE.Vector3();
  const tp = new THREE.Vector3();
  host.scene.traverse((o) => {
    const l = o as THREE.PointLight | THREE.SpotLight;
    if (!(l as THREE.PointLight).isPointLight && !(l as THREE.SpotLight).isSpotLight) return;
    if (!(l.intensity > 0) || !renderVisible(l, host, opts.includeRoof)) return;
    const pin = (l.userData.light ?? {}) as Partial<LightDef>;
    const itemId = itemIdOf(l);
    const spot = (l as THREE.SpotLight).isSpotLight === true;
    l.getWorldPosition(wp);
    const group: LightGroup = pin.group ?? (itemId ? 'decor' : spot ? (wp.z < 0 ? 'deck' : 'interior') : 'porch');
    let id = pin.id ?? (itemId ? `${itemId}:${l.name || 'light'}` : l.name || `${spot ? 'spot' : 'point'}`);
    if (seen.has(id)) {
      let k = 2;
      while (seen.has(`${id}#${k}`)) k++;
      id = `${id}#${k}`;
    }
    seen.add(id);
    const cct = pin.cct;
    const colorLinear: [number, number, number] = cct ? cctToLinear(cct) : [l.color.r, l.color.g, l.color.b];
    const def: LightDef = {
      id,
      kind: spot ? 'spot' : 'point',
      group,
      position: v3(wp),
      colorLinear,
      intensityCd: l.intensity,
      radiusM: pin.radiusM ?? (itemId ? RADIUS_LANTERN : RADIUS_FIXTURE),
      ptMode: pin.ptMode ?? 'light',
    };
    if (cct) def.cct = cct;
    if (spot) {
      const s = l as THREE.SpotLight;
      s.target.updateMatrixWorld(true);
      s.target.getWorldPosition(tp);
      const dir = tp.sub(wp);
      if (dir.lengthSq() < 1e-12) dir.set(0, -1, 0);
      def.direction = v3(dir.normalize());
      def.halfAngleDeg = THREE.MathUtils.radToDeg(s.angle);
      def.penumbra = s.penumbra;
    }
    const emitter = pin.shadowlessEmitter ?? (itemId ? emitterNear(l) : undefined);
    if (emitter) def.shadowlessEmitter = emitter;
    defs.push(def);
  });

  if (opts.target === 'pathtracer') capForPathTracer(defs, opts.camera ?? host.getCamera());
  return defs;
}

/** Keep the ≤ PT_LIGHT_CAP most important 'light' entries (directional
 * always), demote the rest to 'emitter-only'. Importance = cd / d² to the
 * camera. A directional light under 1e-4 of the brightest one (the daytime
 * moon) is 'omit' — with uniform light picking it would only burn samples. */
export function capForPathTracer(defs: LightDef[], camera: THREE.Camera | null | undefined, cap = PT_LIGHT_CAP): void {
  const cam = new THREE.Vector3();
  if (camera) camera.getWorldPosition(cam);
  const maxLux = Math.max(0, ...defs.filter((d) => d.kind === 'directional').map((d) => d.illuminanceLux ?? 0));
  for (const d of defs) {
    if (d.kind === 'directional' && d.ptMode === 'light' && (d.illuminanceLux ?? 0) < maxLux * 1e-4) d.ptMode = 'omit';
  }
  const active = defs.filter((d) => d.ptMode === 'light');
  const dirs = active.filter((d) => d.kind === 'directional');
  const local = active
    .filter((d) => d.kind !== 'directional')
    .map((d) => {
      const dx = d.position[0] - cam.x;
      const dy = d.position[1] - cam.y;
      const dz = d.position[2] - cam.z;
      return { d, score: (d.intensityCd ?? 0) / Math.max(dx * dx + dy * dy + dz * dz, 0.25) };
    })
    .sort((a, b) => b.score - a.score);
  const room = Math.max(cap - dirs.length, 0);
  local.forEach((e, i) => {
    if (i >= room) e.d.ptMode = 'emitter-only';
  });
}

/** THREE light objects for the path tracer (intensities in cd / lux, no
 * range cutoff, inverse-square). Directional lights get their target added
 * to the scene too. */
export function lightObjects(defs: LightDef[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const d of defs) {
    if (d.ptMode !== 'light') continue;
    const color = new THREE.Color().setRGB(d.colorLinear[0], d.colorLinear[1], d.colorLinear[2], THREE.LinearSRGBColorSpace);
    let light: THREE.Light;
    if (d.kind === 'directional') {
      const l = new THREE.DirectionalLight(color, d.illuminanceLux ?? 0);
      const dir = new THREE.Vector3(...(d.direction ?? [0, -1, 0])).normalize();
      l.position.copy(dir).multiplyScalar(-100);
      l.target.position.set(0, 0, 0);
      l.target.name = `${d.id}:target`;
      out.push(l.target);
      light = l;
    } else if (d.kind === 'spot') {
      const l = new THREE.SpotLight(color, d.intensityCd ?? 0, 0, THREE.MathUtils.degToRad(d.halfAngleDeg ?? 30), d.penumbra ?? 0, 2);
      l.position.set(...d.position);
      const dir = new THREE.Vector3(...(d.direction ?? [0, -1, 0]));
      l.target.position.set(d.position[0] + dir.x, d.position[1] + dir.y, d.position[2] + dir.z);
      l.target.name = `${d.id}:target`;
      (l as unknown as { radius: number }).radius = d.radiusM ?? 0; // PT soft shadows
      out.push(l.target);
      light = l;
    } else {
      const l = new THREE.PointLight(color, d.intensityCd ?? 0, 0, 2);
      l.position.set(...d.position);
      light = l;
    }
    light.name = d.id;
    light.userData.lightDef = d;
    out.push(light);
  }
  return out;
}
