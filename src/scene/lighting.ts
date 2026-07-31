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
  cam.left = -22;
  cam.right = 22;
  cam.top = 22;
  cam.bottom = -22;
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

  const setAtmo = (sky: THREE.Color, valley: THREE.Color, fog: number) => {
    if (!atmo) return;
    atmo.skyMat.color.copy(sky);
    atmo.valleyMat.color.copy(valley);
    atmo.fog.color.setHex(fog);
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
      setAtmo(colA.setHex(0xffffff).clone(), colB.setHex(0xffffff).clone(), 0xe8eef2);
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

    const night = alt < -6;
    const twilight = alt >= -6 && alt < 0;

    if (night || twilight) {
      // moody evening: no direct sun, gentle warm interior + porch glow
      const t = night ? 0 : (alt + 6) / 6; // 0 deep night → 1 at horizon
      sun.visible = false;
      hemi.color.copy(lerpHex(0x1b2440, 0x4a5a86, t).clone());
      hemi.groundColor.setHex(0x14100c);
      hemi.intensity = 0.22 + 0.18 * t;
      for (const s of spots) s.intensity = 85;
      for (const p of porch) p.intensity = 26;
      sceneEnv.environmentIntensity = 0.12;
      setAtmo(
        lerpHex(0x141d33, 0x4a5064, t).clone(),
        lerpHex(0x1c2434, 0x3c4152, t).clone(),
        night ? 0x0e1626 : 0x2a3145,
      );
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
    const altBoost = THREE.MathUtils.clamp(alt / 30, 0.45, 1.15);
    // dramatic reading: hot direct beam over a subdued ambient, so the sun's
    // pools and window patterns clearly dominate the scene
    sun.intensity = 3.4 * altBoost * (1 - 0.88 * c);
    sun.position.copy(center).addScaledVector(dir, 40);

    hemi.color.copy(lerpHex(0xbfd4ee, 0xaab2bc, c).clone());
    hemi.groundColor.setHex(0x6d543c);
    hemi.intensity = 0.26 + 0.52 * c; // overcast = flatter, more ambient
    for (const s of spots) s.intensity = 50;
    for (const p of porch) p.intensity = 0;
    sceneEnv.environmentIntensity = 0.2 - 0.06 * c;

    const skyTint = lerpHex(0xffffff, 0x99a1ab, c * 0.85).clone().multiplyScalar(0.6);
    const duskTint = alt < 10 ? lerpHex(0xffc9a0, 0xffffff, alt / 10) : colA.setHex(0xffffff);
    skyTint.multiply(duskTint);
    setAtmo(
      skyTint,
      lerpHex(0xffffff, 0x8e959e, c * 0.8).clone().multiplyScalar(0.55),
      c > 0.5 ? 0x8f9296 : 0x9aa0a8,
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
