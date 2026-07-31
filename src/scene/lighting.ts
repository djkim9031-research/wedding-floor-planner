import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { i2m, ROOM_W, ROOM_D } from '../constants';

export function setupLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): { invalidateShadows(): void } {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // on-demand via invalidateShadows()
  renderer.shadowMap.needsUpdate = true;

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Late-afternoon sun from the NW (~24° elevation)
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
  sun.position.set(cx - 18, 14, cz - 26);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -19;
  cam.right = 19;
  cam.top = 19;
  cam.bottom = -19;
  cam.near = 5;
  cam.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  scene.add(new THREE.HemisphereLight(0xbfd4ee, 0x8a6b4c, 0.5));

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  if ('environmentIntensity' in scene) {
    (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.35;
  }

  // Warm accent spots under the glulam beams (match the fixture props)
  for (const x of [183, 363]) {
    for (const z of [150, 450]) {
      const spot = new THREE.SpotLight(0xffe3bc, 50, 12, 0.5, 0.6, 2);
      spot.position.set(i2m(x), i2m(100), i2m(z));
      spot.target.position.set(i2m(x), 0, i2m(z));
      spot.castShadow = false;
      scene.add(spot, spot.target);
    }
  }

  return {
    invalidateShadows() {
      renderer.shadowMap.needsUpdate = true;
    },
  };
}
