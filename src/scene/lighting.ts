import * as THREE from 'three';
import { onAppReady, type AppContext } from '../app/context';
import { BAY_X, i2m, IN, ROOM_D, ROOM_POLYGON, ROOM_W } from '../constants';
import { excludeFromRender, pbrOf } from '../render/tags';
import type { LightDef } from '../render/types';
import { cctToLinear, exposureScale, luminance, meteredEV100 } from '../sky/exposure';
import { toHalfArray } from '../sky/half';
import { getSky, subscribeSky } from '../sky/skyStore';
import type { SkyState } from '../sky/types';
import { setViewEV100 } from '../sky/viewExposure';
import type { Atmosphere } from './atmosphere';

// ---------------------------------------------------------------------------
// Photometric raster lighting, driven by the physical sky store.
//
// Units are real: DirectionalLight = lux, Point/SpotLight = candela (three
// r155+ "physically correct" lights), scene.background / scene.environment =
// cd/m². Everything is exposed once, in the tone mapper:
//   renderer.toneMappingExposure = exposureScale(EV100) = 1 / (1.2 · 2^EV)
// so sun, fixtures, lanterns, sky and emissive surfaces (tagged with a
// luminance) combine the way a camera would see them. Unlit UI overlays are
// switched to toneMapped = false so they keep their colours at any EV.
// ---------------------------------------------------------------------------

/** Legacy input from main.ts — the store now carries the real state; kept so
 * host.applySun() keeps working as a thin adapter. */
export interface SunInput {
  altitudeDeg: number;
  azimuthModelDeg: number;
  /** 0 = clear, 1 = fully overcast */
  clouds: number;
  moon?: {
    altitudeDeg: number;
    azimuthModelDeg: number;
    fraction: number;
    brightLimbDeg: number;
  };
}

export interface Lighting {
  invalidateShadows(): void;
  /** Adapter: the sky store already holds the state; this just re-applies. */
  applySun(input: SunInput | null): void;
  /** Replace the interior/porch fixtures (e.g. with scene/fixtures.ts data). */
  setFixtures(defs: LightDef[]): void;
  /** EV100 the view is exposed at right now (compensation applied). */
  viewEV100(): number;
}

const DEG = Math.PI / 180;

/** Fraction of the outdoor sky light that reaches the hall's interior with
 * the roof on (glass walls NE + frosted panels S; no GI in raster). */
export const INTERIOR_ENV_FACTOR = 0.18;
/** Share of the direct sun metered inside (patches through the glazing). */
const INTERIOR_SUN_SHARE = 0.1;

const TRACK_CCT = 3000;
const PORCH_CCT = 2700;

/** Default fixtures: ~3000 K LED track heads (36° beam) just under the eight
 * ceiling-disc props on the glulam beams, and three 2700 K porch lights.
 * Replaced wholesale by setFixtures() once the venue's fixture layout lands. */
export const DEFAULT_FIXTURES: LightDef[] = [
  ...[BAY_X[1], BAY_X[2]].flatMap((x) =>
    [150, 250, 350, 450].map(
      (z): LightDef => ({
        id: `track-${Math.round(x)}-${z}`,
        kind: 'spot',
        group: 'interior',
        position: [i2m(x), i2m(98), i2m(z)],
        direction: [0, -1, 0],
        cct: TRACK_CCT,
        colorLinear: cctToLinear(TRACK_CCT),
        intensityCd: 2000,
        // field half-angle 26°, soft edge: ~36–38° beam at 50 %
        halfAngleDeg: 26,
        penumbra: 0.55,
        radiusM: 0.03,
        ptMode: 'light',
      }),
    ),
  ),
  ...(
    [
      [180, 96, -30],
      [400, 96, -30],
      [272, 96, 690],
    ] as const
  ).map(
    ([x, y, z], i): LightDef => ({
      id: `porch-${i}`,
      kind: 'point',
      group: 'porch',
      position: [i2m(x), i2m(y), i2m(z)],
      cct: PORCH_CCT,
      colorLinear: cctToLinear(PORCH_CCT),
      // ~750 lm A19-class wall lantern
      intensityCd: 60,
      radiusM: 0.05,
      ptMode: 'light',
    }),
  ),
];

// ---------------------------------------------------------------------------
// Hall footprint (for the interior IBL factor and exposure metering)
// ---------------------------------------------------------------------------

const ROOF_TOP_IN = 200;
const HALL_POLYGONS_IN: { x: number; z: number }[][] = [
  ROOM_POLYGON,
  // annex hallway along the south side
  [
    { x: -597, z: 593 },
    { x: 700, z: 593 },
    { x: 700, z: 659 },
    { x: -597, z: 659 },
  ],
];

function polySignedDist(poly: { x: number; z: number }[], px: number, pz: number): number {
  // + inside, − outside, inches
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(px - a.x - t * dx, pz - a.z - t * dz));
  }
  return inside ? best : -best;
}

/** 0..1 how far inside the hall footprint (smooth over ±18") a world point is. */
function insideHall(x: number, y: number, z: number): number {
  const px = x / IN;
  const pz = z / IN;
  let d = -Infinity;
  for (const p of HALL_POLYGONS_IN) d = Math.max(d, polySignedDist(p, px, pz));
  const plan = THREE.MathUtils.clamp(0.5 + d / 36, 0, 1);
  const vert = THREE.MathUtils.clamp((ROOF_TOP_IN - y / IN) / 24 + 0.5, 0, 1);
  return plan * vert;
}

// ---------------------------------------------------------------------------

export function setupLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, atmo: Atmosphere | null): Lighting {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // on-demand via invalidateShadows()
  renderer.shadowMap.needsUpdate = true;

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);
  const center = new THREE.Vector3(cx, 0, cz);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  let ctx: AppContext | null = null;
  const invalidate = (): void => ctx?.host.invalidate();
  const invalidateShadows = (): void => {
    renderer.shadowMap.needsUpdate = true;
  };

  // --- sun (or moon, once the sun is down): one shadow-casting directional,
  // always present so the light count — and every shader — stays stable
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(cx - 18, 14, cz - 26);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -24;
  cam.right = 24;
  cam.top = 24;
  cam.bottom = -24;
  cam.near = 5;
  cam.far = 95;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // incoming-ray arrow over the room (planning aid, never rendered)
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 6, 0xb08d57, 1.4, 0.7);
  arrow.visible = false;
  scene.add(excludeFromRender(arrow));

  // --- sky: background (bg, with stars + moon) and IBL (env → PMREM) -------
  const makeEquirect = (w: number, h: number): THREE.DataTexture => {
    const t = new THREE.DataTexture(new Uint16Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  let bgTex: THREE.DataTexture | null = null;
  let envTex: THREE.DataTexture | null = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  let lastPmrem = -Infinity;
  let pmremTimer: ReturnType<typeof setTimeout> | null = null;
  const regenPmrem = (): void => {
    pmremTimer = null;
    if (!envTex) return;
    lastPmrem = performance.now();
    envRT = pmrem.fromEquirectangular(envTex, envRT);
    scene.environment = envRT.texture;
    invalidate();
  };
  const schedulePmrem = (): void => {
    // the slider can fire every frame; PMREM at most every 100 ms, with a
    // trailing update so the final position always lands
    const wait = 100 - (performance.now() - lastPmrem);
    if (wait <= 0 && !pmremTimer) regenPmrem();
    else if (!pmremTimer) pmremTimer = setTimeout(regenPmrem, Math.max(wait, 0));
  };
  scene.backgroundIntensity = 1;

  // --- fixtures -------------------------------------------------------------
  interface Fixture {
    def: LightDef;
    light: THREE.SpotLight | THREE.PointLight;
  }
  let fixtures: Fixture[] = [];
  const setFixtures = (defs: LightDef[]): void => {
    for (const f of fixtures) {
      scene.remove(f.light);
      if (f.light instanceof THREE.SpotLight) scene.remove(f.light.target);
      f.light.dispose();
    }
    fixtures = defs
      .filter((d) => d.kind !== 'directional')
      .map((def) => {
        const col = new THREE.Color().setRGB(...def.colorLinear, THREE.LinearSRGBColorSpace);
        const cd = def.intensityCd ?? 0;
        const light =
          def.kind === 'spot'
            ? new THREE.SpotLight(col, 0, 0, (def.halfAngleDeg ?? 25) * DEG, def.penumbra ?? 0.5, 2)
            : new THREE.PointLight(col, 0, 0, 2);
        light.position.set(...def.position);
        if (light instanceof THREE.SpotLight) {
          const d = def.direction ?? [0, -1, 0];
          light.target.position.set(def.position[0] + d[0], def.position[1] + d[1], def.position[2] + d[2]);
          scene.add(light.target);
        }
        light.castShadow = false;
        light.userData.lightDef = def;
        light.userData.baseIntensity = cd / Math.max(luminance(def.colorLinear), 1e-3);
        scene.add(light);
        return { def, light };
      });
    applyFixtureLevels();
    invalidate();
  };
  let porchLevel = 0;
  const applyFixtureLevels = (): void => {
    for (const f of fixtures) {
      const on = f.def.group === 'porch' || f.def.group === 'deck' ? porchLevel : 1;
      f.light.intensity = (f.light.userData.baseIntensity as number) * on;
      // what a render export should use right now (photocell applied)
      f.light.userData.lightDef = { ...f.def, intensityCd: (f.def.intensityCd ?? 0) * on } satisfies LightDef;
    }
  };
  /** representative interior illuminance from the fixtures, lux: ~30 % of
   * the brightest pool (metering target, not a light) */
  const fixtureLux = (): number => {
    let peak = 0;
    for (const f of fixtures) {
      if (f.def.group !== 'interior') continue;
      const h = Math.max(f.def.position[1], 1);
      peak = Math.max(peak, (f.def.intensityCd ?? 0) / (h * h));
    }
    return 0.3 * peak;
  };

  // --- per-sky update -------------------------------------------------------
  let sky: SkyState | null = null;
  let lastBg: SkyState['bg'] | null = null;
  let lastEnv: SkyState['env'] | null = null;
  const lastDir = new THREE.Vector3();
  let lastLux = -1;
  const dir = new THREE.Vector3();

  const applySky = (s: SkyState): void => {
    const t0 = performance.now();
    sky = s;
    // backgrounds: the equirect → cube conversion is cached per texture, so
    // a fresh upload also drops the cache (dispose) before the next frame.
    // Exposure-only changes keep the same images: skip the uploads.
    if (s.bg !== lastBg) {
      lastBg = s.bg;
      if (!bgTex || bgTex.image.width !== s.bg.w) {
        bgTex?.dispose();
        bgTex = makeEquirect(s.bg.w, s.bg.h);
        scene.background = bgTex;
      }
      bgTex.image.data = toHalfArray(s.bg.data, bgTex.image.data as Uint16Array);
      bgTex.dispose();
      bgTex.needsUpdate = true;
    }
    const envChanged = s.env !== lastEnv;
    if (envChanged) {
      lastEnv = s.env;
      if (!envTex || envTex.image.width !== s.env.w) {
        envTex?.dispose();
        envTex = makeEquirect(s.env.w, s.env.h);
      }
      envTex.image.data = toHalfArray(s.env.data, envTex.image.data as Uint16Array);
      envTex.needsUpdate = true;
      schedulePmrem();
    }

    // direct light: the sun while it is up, else the moon
    const sunUp = s.sun.illuminanceLux > 0.5;
    const moonUp = !sunUp && s.moon.illuminanceLux > 1e-4 && s.moon.altDeg > 0;
    const body = sunUp ? s.sun : moonUp ? s.moon : null;
    if (body) {
      dir.set(...body.dir);
      // keep the light a hair above the horizon plane for the shadow camera
      if (dir.y < 0.02) dir.setY(0.02).normalize();
      sun.color.setRGB(...body.colorLinear, THREE.LinearSRGBColorSpace);
      sun.intensity = body.illuminanceLux / Math.max(luminance(body.colorLinear), 1e-3);
      sun.position.copy(center).addScaledVector(dir, 40);
    } else {
      sun.intensity = 0;
    }
    const lux = body ? body.illuminanceLux : 0;
    sun.userData.lightDef = {
      id: sunUp ? 'sun' : 'moon',
      kind: 'directional',
      group: 'sky',
      position: [0, 0, 0],
      direction: body ? [-body.dir[0], -body.dir[1], -body.dir[2]] : [0, -1, 0],
      colorLinear: body ? [...body.colorLinear] : [1, 1, 1],
      illuminanceLux: lux,
      ptMode: 'light',
    } satisfies LightDef;
    if (dir.angleTo(lastDir) > 1e-4 || (lux > 0) !== (lastLux > 0)) invalidateShadows();
    lastDir.copy(dir);
    lastLux = lux;

    arrow.visible = sunUp;
    if (sunUp) {
      const sd = new THREE.Vector3(...s.sun.dir);
      arrow.position.copy(center).addScaledVector(sd, 14);
      arrow.setDirection(sd.clone().negate());
    }

    // porch/deck lights: photocell, on as the light falls below ~400 lux
    const E = outdoorLux(s);
    porchLevel = THREE.MathUtils.clamp((Math.log10(400) - Math.log10(Math.max(E, 1e-6))) / Math.log10(4), 0, 1);
    applyFixtureLevels();

    if (envChanged) atmo?.applySky(s);
    updateExposure(0);
    invalidate();
    // QA/diagnostics: cost of pushing a sky update to the GPU side (ms)
    (window as unknown as { __wpSkyApplyMs?: number }).__wpSkyApplyMs = performance.now() - t0;
  };

  const outdoorLux = (s: SkyState): number =>
    s.skyHorizontalLux +
    s.sun.illuminanceLux * Math.max(Math.sin(s.sun.altDeg * DEG), 0) +
    s.moon.illuminanceLux * Math.max(Math.sin(s.moon.altDeg * DEG), 0);

  // --- camera-aware exposure + interior IBL ---------------------------------
  let envFactor = 1;
  let ev = 12;
  let evTarget = 12;
  let envTarget = 1;
  let lastW = 0;
  const ray = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const SAMPLES: [number, number, number][] = [
    [0, 0, 0.4],
    [-0.55, -0.45, 0.15],
    [0.55, -0.45, 0.15],
    [-0.55, 0.45, 0.15],
    [0.55, 0.45, 0.15],
  ];

  /** targets from the camera: inside the hall with the roof on, the IBL is
   * mostly occluded and the fixtures set the exposure; with the roof off, the
   * share of the view that lands on the hall floor decides */
  const computeTargets = (): void => {
    if (!sky) return;
    const camera = ctx?.host.getCamera();
    const roofOn = ctx?.host.roofVisible() ?? false;
    let w = 0;
    let inside = 0;
    if (camera) {
      camera.getWorldPosition(camPos);
      inside = insideHall(camPos.x, camPos.y, camPos.z);
      if (roofOn) {
        w = inside;
      } else {
        for (const [nx, ny, k] of SAMPLES) {
          ray.set(nx, ny, 0.5).unproject(camera).sub(camPos).normalize();
          if (ray.y >= -1e-3) continue;
          const t = -camPos.y / ray.y;
          if (t > 60) continue;
          w += k * insideHall(camPos.x + ray.x * t, 0.5, camPos.z + ray.z * t);
        }
      }
    }
    envTarget = roofOn ? THREE.MathUtils.lerp(1, INTERIOR_ENV_FACTOR, inside) : 1;
    lastW = w;
    const inp = sky.input;
    if (!inp.autoEV) {
      evTarget = sky.ev100;
      return;
    }
    const Eout = outdoorLux(sky);
    const sunH = sky.sun.illuminanceLux * Math.max(Math.sin(sky.sun.altDeg * DEG), 0);
    const Ein = roofOn
      ? INTERIOR_ENV_FACTOR * sky.skyHorizontalLux + INTERIOR_SUN_SHARE * sunH + fixtureLux()
      : Eout + fixtureLux();
    evTarget = meteredEV100((1 - w) * Eout + w * Ein) - inp.evComp;
  };

  const updateExposure = (dt: number): boolean => {
    computeTargets();
    // eye-like adaptation: ~0.25 s time constant; snap on sky changes and
    // when frames are slow (software GL, hitches) so it never drags on
    const k = dt > 0 && dt < 0.09 ? 1 - Math.exp(-dt / 0.25) : 1;
    const evPrev = ev;
    const envPrev = envFactor;
    ev += (evTarget - ev) * k;
    envFactor += (envTarget - envFactor) * k;
    if (Math.abs(evTarget - ev) < 0.01) ev = evTarget;
    if (Math.abs(envTarget - envFactor) < 0.002) envFactor = envTarget;
    renderer.toneMappingExposure = exposureScale(ev);
    scene.environmentIntensity = envFactor;
    setViewEV100(ev);
    // QA/diagnostics: what the view is exposed at and why
    (window as unknown as { __wpExposure?: object }).__wpExposure = { ev, evTarget, envFactor, envTarget, meterWeight: lastW };
    return ev !== evPrev || envFactor !== envPrev;
  };

  // --- material hygiene under physical exposure -----------------------------
  // Emitters tagged with a luminance (cd/m²) get the matching emissive
  // intensity; untagged unlit UI (ghost plates, outlines, rings, arrows)
  // opts out of tone mapping so it reads the same at EV 1 and EV 15.
  const seenUi = new WeakSet<THREE.Material>();
  const fixMaterial = (m: THREE.Material): void => {
    const tagInfo = pbrOf(m);
    if (tagInfo?.luminance !== undefined && 'emissive' in m) {
      const em = (m as THREE.MeshStandardMaterial).emissive;
      const y = luminance([em.r, em.g, em.b]);
      if (y > 1e-6) {
        const want = tagInfo.luminance / y;
        const sm = m as THREE.MeshStandardMaterial;
        if (Math.abs(sm.emissiveIntensity - want) > 1e-3 * want) sm.emissiveIntensity = want;
      }
      return;
    }
    if (tagInfo || seenUi.has(m)) return;
    if (
      m instanceof THREE.MeshBasicMaterial ||
      m instanceof THREE.LineBasicMaterial ||
      m instanceof THREE.SpriteMaterial ||
      m instanceof THREE.PointsMaterial
    ) {
      seenUi.add(m);
      if (m.toneMapped) {
        m.toneMapped = false;
        m.needsUpdate = true;
      }
    }
  };
  const sweepMaterials = (): void => {
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(fixMaterial);
      else fixMaterial(mat);
    });
  };

  // --- boot -----------------------------------------------------------------
  setFixtures(DEFAULT_FIXTURES);
  subscribeSky(applySky);
  applySky(getSky());
  sweepMaterials();

  onAppReady((c) => {
    ctx = c;
    // the roof shadows the room whenever it is shown (hidden objects never
    // reach the shadow map, so no toggling is needed)
    c.host.roof.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    invalidateShadows();
    let sweepT = 0;
    c.host.onFrame((dt) => {
      sweepT += dt;
      if (sweepT > 0.5) {
        sweepT = 0;
        sweepMaterials();
      }
      // invalidate (not `return true`): a returned true also re-renders the
      // shadow map every frame, which adaptation doesn't need
      if (updateExposure(dt)) c.host.invalidate();
    });
    sweepMaterials();
    updateExposure(0);
    invalidate();
  });

  return {
    invalidateShadows,
    applySun: () => {
      // the sky store is the source of truth (main.ts set it just before)
      invalidate();
    },
    setFixtures,
    viewEV100: () => ev,
  };
}
