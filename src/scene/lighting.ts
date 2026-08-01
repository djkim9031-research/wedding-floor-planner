import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { i2m, ROOM_W, ROOM_D } from '../constants';
import type { Atmosphere } from './exterior';

/** Live sun input: real solar altitude/azimuth (model frame) + cloud cover. */
export interface SunInput {
  altitudeDeg: number;
  azimuthModelDeg: number;
  /** 0 = clear, 1 = fully overcast */
  clouds: number;
}

export interface Lighting {
  invalidateShadows(): void;
  /** Drive the rig from a real sun state; null restores the showcase preset. */
  applySun(input: SunInput | null): void;
}

const DEG = Math.PI / 180;

export function setupLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  atmo: Atmosphere | null,
): Lighting {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // on-demand via invalidateShadows()
  renderer.shadowMap.needsUpdate = true;

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);
  const center = new THREE.Vector3(cx, 0, cz);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Showcase default: late-afternoon sun from the NW (~24° elevation)
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
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

  const hemi = new THREE.HemisphereLight(0xbfd4ee, 0x8a6b4c, 0.5);
  scene.add(hemi);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const sceneEnv = scene as THREE.Scene & { environmentIntensity?: number };
  if ('environmentIntensity' in scene) sceneEnv.environmentIntensity = 0.35;

  // Warm accent spots under the glulam beams (match the fixture props)
  const spots: THREE.SpotLight[] = [];
  for (const x of [183, 363]) {
    for (const z of [150, 450]) {
      const spot = new THREE.SpotLight(0xffe3bc, 50, 12, 0.5, 0.6, 2);
      spot.position.set(i2m(x), i2m(100), i2m(z));
      spot.target.position.set(i2m(x), 0, i2m(z));
      spot.castShadow = false;
      scene.add(spot, spot.target);
      spots.push(spot);
    }
  }

  // Night-only porch lights: two on the deck face, one over the entry porch
  const porch: THREE.PointLight[] = [];
  for (const [px, py, pz] of [
    [180, 96, -30],
    [400, 96, -30],
    [272, 96, 690],
  ]) {
    const p = new THREE.PointLight(0xffd9a0, 0, 9, 2);
    p.position.set(i2m(px), i2m(py), i2m(pz));
    scene.add(p);
    porch.push(p);
  }

  // Sun disc on the sky + incoming-ray arrow over the room
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  disc.visible = false;
  scene.add(disc);
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(),
    6,
    0xb08d57,
    1.4,
    0.7,
  );
  arrow.visible = false;
  scene.add(arrow);

  const invalidateShadows = () => {
    renderer.shadowMap.needsUpdate = true;
  };

  const colA = new THREE.Color();
  const colB = new THREE.Color();
  const lerpHex = (a: number, b: number, t: number): THREE.Color =>
    colA.setHex(a).lerp(colB.setHex(b), THREE.MathUtils.clamp(t, 0, 1));

  const fogCol = new THREE.Color();
  const setAtmo = (sky: THREE.Color, valley: THREE.Color, fog: THREE.Color) => {
    if (!atmo) return;
    atmo.skyMat.color.copy(sky);
    atmo.valleyMat.color.copy(valley);
    atmo.ringMat.color.copy(valley).multiplyScalar(0.92); // near canopy a shade deeper
    atmo.fog.color.copy(fog);
  };

  const applySun = (input: SunInput | null): void => {
    if (!input) {
      sun.visible = true;
      sun.color.setHex(0xffd9a8);
      sun.intensity = 2.4;
      sun.position.set(cx - 18, 14, cz - 26);
      hemi.color.setHex(0xbfd4ee);
      hemi.groundColor.setHex(0x8a6b4c);
      hemi.intensity = 0.5;
      for (const s of spots) s.intensity = 50;
      for (const p of porch) p.intensity = 0;
      sceneEnv.environmentIntensity = 0.35;
      setAtmo(colA.setHex(0xffffff).clone(), colB.setHex(0xffffff).clone(), fogCol.setHex(0xe8eef2));
      disc.visible = false;
      arrow.visible = false;
      invalidateShadows();
      return;
    }

    const { altitudeDeg: alt, azimuthModelDeg: azm } = input;
    const c = THREE.MathUtils.clamp(input.clouds, 0, 1);
    const a = azm * DEG;
    const h = Math.max(alt, 1) * DEG; // keep the light above the horizon plane
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));

    if (alt < 0) {
      // smooth twilight ladder: sunset → civil (−6°) → nautical (−12°) →
      // astronomical (−18°) → night; every quantity interpolates between
      // keyframes so the evening fades naturally
      const KEYS = [
        { a: 0, hemi: 0xf0a45c, hemiI: 0.42, sky: 0xa06a44, valley: 0x8a6a52, fog: 0xd8bfa5, spot: 60, porch: 12, env: 0.22 },
        { a: -6, hemi: 0x4a5a86, hemiI: 0.34, sky: 0x4a5064, valley: 0x3c4152, fog: 0x2a3145, spot: 85, porch: 26, env: 0.15 },
        { a: -12, hemi: 0x2a3658, hemiI: 0.26, sky: 0x232c47, valley: 0x242938, fog: 0x17203a, spot: 85, porch: 26, env: 0.12 },
        { a: -18, hemi: 0x1b2440, hemiI: 0.22, sky: 0x141d33, valley: 0x1c2434, fog: 0x0e1626, spot: 85, porch: 26, env: 0.12 },
      ];
      const aa = Math.max(alt, -18);
      let k = 0;
      while (k < KEYS.length - 2 && aa < KEYS[k + 1].a) k++;
      const k0 = KEYS[k];
      const k1 = KEYS[k + 1];
      const t = THREE.MathUtils.clamp((k0.a - aa) / (k0.a - k1.a), 0, 1);
      sun.visible = false;
      hemi.color.copy(lerpHex(k0.hemi, k1.hemi, t).clone());
      hemi.groundColor.setHex(0x14100c);
      hemi.intensity = THREE.MathUtils.lerp(k0.hemiI, k1.hemiI, t);
      const spotI = THREE.MathUtils.lerp(k0.spot, k1.spot, t);
      for (const s of spots) s.intensity = spotI;
      const porchI = THREE.MathUtils.lerp(k0.porch, k1.porch, t);
      for (const p of porch) p.intensity = porchI;
      sceneEnv.environmentIntensity = THREE.MathUtils.lerp(k0.env, k1.env, t);
      const sky = lerpHex(k0.sky, k1.sky, t).clone();
      const val = lerpHex(k0.valley, k1.valley, t).clone();
      setAtmo(sky, val, fogCol.copy(lerpHex(k0.fog, k1.fog, t)));
      disc.visible = false;
      arrow.visible = false;
      invalidateShadows();
      return;
    }

    // Daytime: color/intensity ramp by altitude, damped by cloud cover
    sun.visible = true;
    const warm =
      alt < 8
        ? lerpHex(0xff8c4a, 0xffb877, alt / 8)
        : alt < 25
          ? lerpHex(0xffb877, 0xffd9a8, (alt - 8) / 17)
          : lerpHex(0xffd9a8, 0xfff2dc, (alt - 25) / 40);
    sun.color.copy(warm).lerp(colB.setHex(0xe6e6e6), c * 0.7);
    const altBoost = THREE.MathUtils.clamp(alt / 30, 0.6, 1.15);
    // dramatic reading: hot direct beam over a subdued ambient, so the sun's
    // pools and window patterns clearly dominate the scene
    sun.intensity = 3.4 * altBoost * (1 - 0.88 * c);
    sun.position.copy(center).addScaledVector(dir, 40);

    // ambient follows the day cycle: sky-blue at midday, golden near the
    // horizon — outdoors reads bright while the hot direct beam still
    // dominates indoors through the glazing
    const golden = THREE.MathUtils.clamp(1 - alt / 25, 0, 1);
    hemi.color.copy(lerpHex(0xbfd9f5, 0xf0a45c, golden).clone().lerp(colB.setHex(0xaab2bc), c * 0.7));
    hemi.groundColor.setHex(0x8a6b4c);
    hemi.intensity = 0.5 + 0.12 * (1 - golden) + 0.4 * c;
    const duskFade = THREE.MathUtils.clamp(1 - alt / 6, 0, 1);
    for (const s of spots) s.intensity = 50 + 10 * duskFade;
    for (const p of porch) p.intensity = 12 * duskFade;
    sceneEnv.environmentIntensity = 0.3 - 0.08 * c - 0.08 * duskFade;

    const skyTint = lerpHex(0xffffff, 0xffb066, golden)
      .clone()
      .multiplyScalar(0.85 - 0.1 * golden)
      .lerp(colB.setHex(0x6f767e), c * 0.75);
    setAtmo(
      skyTint,
      lerpHex(0xffffff, 0xe0b894, golden).clone().multiplyScalar(0.72).lerp(colB.setHex(0x777d85), c * 0.7),
      fogCol.setHex(c > 0.5 ? 0x9b9ea3 : golden > 0.5 ? 0xd8bfa5 : 0xc9d2dc),
    );

    disc.visible = true;
    disc.material.opacity = 0.95 - 0.75 * c;
    disc.position.copy(center).addScaledVector(dir, 230);
    disc.lookAt(center);

    arrow.visible = true;
    const origin = center.clone().addScaledVector(dir, 14);
    arrow.position.copy(origin);
    arrow.setDirection(dir.clone().negate());
    invalidateShadows();
  };

  return { invalidateShadows, applySun };
}
