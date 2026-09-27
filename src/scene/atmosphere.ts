import * as THREE from 'three';
import { i2m, ROOM_D, ROOM_W } from '../constants';
import { excludeFromRender, tag } from '../render/tags';
import { bayPanoramaTexture, skyTexture, treetopRingTexture } from './textures';

// ---------------------------------------------------------------------------
// Sky dome, valley backdrop and fog.
// ---------------------------------------------------------------------------

export interface Atmosphere {
  skyMat: THREE.MeshBasicMaterial;
  valleyMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  fog: THREE.Fog;
}

export function applyAtmosphere(scene: THREE.Scene): Atmosphere {
  scene.fog = new THREE.Fog(0xe8eef2, 45, 160);

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(250, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.position.set(cx, 0, cz);
  sky.renderOrder = -2;
  excludeFromRender(sky); // replaced by the physical sky in photo/Blender renders
  scene.add(sky);

  // full-circle Bay Area panorama; haze baked in, so fog:false
  const valley = new THREE.Mesh(
    new THREE.CylinderGeometry(85, 85, 40, 96, 1, true),
    tag(
      new THREE.MeshBasicMaterial({
        map: bayPanoramaTexture(),
        side: THREE.BackSide,
        transparent: true,
        fog: false,
        depthWrite: false,
      }),
      'backplate',
      { cameraOnly: true, castShadow: false },
      'bayPanorama',
    ),
  );
  valley.position.set(cx, 7, cz);
  valley.renderOrder = -1;
  scene.add(valley);

  // ground plane to the horizon: a broad lawn disc under everything, so
  // downward views land on grass (it takes the scene lights, darkening at
  // night) instead of the void behind the backdrop
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(260, 48),
    tag(new THREE.MeshStandardMaterial({ color: 0x76825a, roughness: 1, metalness: 0 }), 'ground', {}, 'lawn'),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, -0.55, cz);
  scene.add(lawn);

  // near treetop ring just past the knoll: crowns rise above deck level and
  // parallax against the painted valley as the camera moves
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(58, 58, 13, 96, 1, true),
    tag(
      new THREE.MeshBasicMaterial({
        map: treetopRingTexture(),
        side: THREE.BackSide,
        transparent: true,
        alphaTest: 0.35,
        depthWrite: false,
      }),
      'backplate',
      { cameraOnly: true, castShadow: false },
      'treetopRing',
    ),
  );
  ring.position.set(cx, -0.8, cz);
  ring.renderOrder = -1;
  scene.add(ring);

  return {
    skyMat: sky.material as THREE.MeshBasicMaterial,
    valleyMat: valley.material as THREE.MeshBasicMaterial,
    ringMat: ring.material as THREE.MeshBasicMaterial,
    fog: scene.fog as THREE.Fog,
  };
}
