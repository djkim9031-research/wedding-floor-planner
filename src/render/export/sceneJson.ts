import * as THREE from 'three';
import { i2m } from '../../constants';
import { FACADE_AZ_DEG, VENUE, tzOffsetMinutes } from '../../scene/sun';
import type { SkyState } from '../../sky/types';
import { getViewEV100 } from '../../sky/viewExposure';
import type { LightDef, PbrTag } from '../types';

/** The Blender job contract ("wp-scene/1", see blender/README.md). All
 * coordinates are three.js world (Y up, meters); the Python side maps them
 * to Blender with (x, y, z) → (x, −z, y). */
export interface WpSceneJson {
  schema: 'wp-scene/1';
  app: { version: string; three: string; exportedAt: string };
  frame: { source: 'three-yup-meters'; blenderMap: '(x,y,z)->(x,-z,y)' };
  venue: { lat: number; lon: number; elevM: number; tz: string; facadeAzDeg: number };
  time: { date: string; minutes: number; utc: string };
  sun: {
    altitudeDeg: number;
    azimuthTrueDeg: number;
    dir: [number, number, number];
    visible: boolean;
    illuminanceLux: number;
    colorLinear: [number, number, number];
    angularDiameterDeg: number;
  };
  moon: { dir: [number, number, number]; fraction: number; illuminanceLux: number; colorLinear: [number, number, number] };
  sky: { file: string; units: 'W/m2/sr'; cdPerUnit: 683; convention: 'three-equirect'; clouds: number };
  camera: {
    type: 'perspective';
    position: [number, number, number];
    quaternion: [number, number, number, number];
    fovYDeg: number;
    aspect: number;
    near: number;
    far: number;
    dof: { enabled: boolean; focusM: number; fStop: number };
  };
  exposure: { ev100: number; evComp: number; view: 'AgX'; look: 'None'; auto: boolean };
  render: {
    w: number;
    h: number;
    samples: number;
    noiseThreshold: number;
    denoise: 'OIDN';
    maxBounces: number;
    preset: string;
    saveBlend: boolean;
    panorama: boolean;
  };
  lights: LightDef[];
  materials: Record<string, PbrTag>;
  objects: Record<string, unknown>;
  checkpoints: Array<{ world: [number, number, number]; px: [number, number] }>;
  stats: Record<string, unknown>;
}

export interface RenderSettings {
  preset: 'draft' | 'standard' | 'final';
  w: number;
  h: number;
  samples: number;
  panorama: boolean;
  saveBlend: boolean;
  dof: { enabled: boolean; focusM: number; fStop: number };
}

export const BLENDER_PRESETS: Record<RenderSettings['preset'], { w: number; h: number; samples: number; label: string; minutes: string }> = {
  draft: { w: 960, h: 540, samples: 128, label: 'Draft · 960×540', minutes: '~1–3 min' },
  standard: { w: 1920, h: 1080, samples: 256, label: 'Standard · 1920×1080', minutes: '~4–10 min' },
  final: { w: 2560, h: 1440, samples: 1024, label: 'Final · 2560×1440', minutes: '~15–40 min' },
};

function utcIso(date: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + (minutes - tzOffsetMinutes(date)) * 60000;
  return new Date(ms).toISOString();
}

/** World points (tabletops, item centers) projected into the render frame —
 * the Blender side reprojects them to prove the camera transfer is exact. */
export function checkpoints(
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  items: Array<{ x: number; z: number; topIn: number }>,
): WpSceneJson['checkpoints'] {
  const cam = camera.clone();
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const out: WpSceneJson['checkpoints'] = [];
  const v = new THREE.Vector3();
  for (const it of items) {
    const world: [number, number, number] = [i2m(it.x), i2m(it.topIn), i2m(it.z)];
    v.set(...world).project(cam);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) continue;
    out.push({ world, px: [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h] });
    if (out.length >= 8) break;
  }
  return out;
}

export function buildSceneJson(p: {
  sky: SkyState;
  camera: THREE.PerspectiveCamera;
  settings: RenderSettings;
  lights: LightDef[];
  roles: Record<string, PbrTag>;
  checkpoints: WpSceneJson['checkpoints'];
  stats: Record<string, unknown>;
  appVersion: string;
}): WpSceneJson {
  const { sky, camera, settings } = p;
  camera.updateMatrixWorld();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  camera.matrixWorld.decompose(pos, quat, new THREE.Vector3());
  const inp = sky.input;
  return {
    schema: 'wp-scene/1',
    app: { version: p.appVersion, three: THREE.REVISION, exportedAt: new Date().toISOString() },
    frame: { source: 'three-yup-meters', blenderMap: '(x,y,z)->(x,-z,y)' },
    venue: { lat: VENUE.lat, lon: VENUE.lon, elevM: VENUE.elevM, tz: VENUE.tz, facadeAzDeg: FACADE_AZ_DEG },
    time: { date: inp.date, minutes: inp.minutes, utc: utcIso(inp.date, inp.minutes) },
    sun: {
      altitudeDeg: sky.sun.altDeg,
      azimuthTrueDeg: sky.sun.azTrueDeg,
      dir: sky.sun.dir,
      visible: sky.sun.illuminanceLux > 0,
      illuminanceLux: sky.sun.illuminanceLux,
      colorLinear: sky.sun.colorLinear,
      angularDiameterDeg: sky.sun.angularDiameterDeg,
    },
    moon: { dir: sky.moon.dir, fraction: sky.moon.fraction, illuminanceLux: sky.moon.illuminanceLux, colorLinear: sky.moon.colorLinear },
    sky: { file: 'sky.exr', units: 'W/m2/sr', cdPerUnit: 683, convention: 'three-equirect', clouds: inp.cloudPct / 100 },
    camera: {
      type: 'perspective',
      position: [pos.x, pos.y, pos.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      fovYDeg: camera.fov,
      aspect: settings.w / settings.h,
      near: 0.05,
      far: 2000,
      dof: settings.dof,
    },
    // metered EV of the live view (interior metering included); Blender applies evComp itself.
    // auto stays off: the app has already metered (Auto EV), and a second meter in Blender
    // (log-average, K 12.5) diverges from the editor, e.g. 1.5 stops darker on a sunlit top view
    exposure: { ev100: (getViewEV100() ?? sky.ev100) + inp.evComp, evComp: inp.evComp, view: 'AgX', look: 'None', auto: false },
    render: {
      w: settings.panorama ? Math.max(settings.w, 2 * settings.h) : settings.w,
      h: settings.panorama ? Math.max(settings.w, 2 * settings.h) / 2 : settings.h,
      samples: settings.samples,
      noiseThreshold: 0.02,
      denoise: 'OIDN',
      maxBounces: 8,
      preset: settings.preset,
      saveBlend: settings.saveBlend,
      panorama: settings.panorama,
    },
    lights: p.lights.map((l) => ({ ...l, ptMode: 'light' as const })),
    materials: p.roles,
    objects: {},
    checkpoints: p.checkpoints,
    stats: p.stats,
  };
}
