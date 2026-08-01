import * as THREE from 'three';
import { i2m } from '../constants';
import { floorWoodTextures } from '../scene/textures';

/** The sandbox floor extent (inches, centered on the origin). */
export const STUDIO_HALF = 180; // 30' square studio
export const STUDIO_RECT = [
  { x: -STUDIO_HALF, z: -STUDIO_HALF },
  { x: STUDIO_HALF, z: -STUDIO_HALF },
  { x: STUDIO_HALF, z: STUDIO_HALF },
  { x: -STUDIO_HALF, z: STUDIO_HALF },
];

export interface StudioScene {
  scene: THREE.Scene;
  itemsGroup: THREE.Group;
  overlayGroup: THREE.Group;
  topCam: THREE.OrthographicCamera;
  /** N, E, S, W elevations (looking at that face of the group) */
  sideCams: Record<'N' | 'E' | 'S' | 'W', THREE.OrthographicCamera>;
  /** re-frame every camera around the current content bounds (inches);
   * aspects = width/height of each on-screen viewport rect */
  frame(
    bboxIn: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
    aspects?: { top: number; N: number; E: number; S: number; W: number },
  ): void;
  /** top view screen↔world mapping (inches), updated by frame() */
  topView: { cx: number; cz: number; spanIn: number };
  dispose(): void;
}

/** A neutral, well-lit studio: wood floor, soft sky light, no walls — the four
 * elevation cameras see each table-group face floor-to-top unobstructed. */
export function createStudioScene(): StudioScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e4da);

  const wood = floorWoodTextures();
  const floorSize = i2m(STUDIO_HALF * 2 + 240);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({
      map: wood.map,
      roughnessMap: wood.roughnessMap,
      roughness: 1,
      metalness: 0,
    }),
  );
  wood.map.repeat.setScalar(floorSize / i2m(128));
  wood.roughnessMap.repeat.copy(wood.map.repeat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a7a62, 0.85);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xe8eef5, 0.7); // north-side fill
  fill.position.set(i2m(-100), i2m(160), i2m(-160));
  scene.add(fill);
  const key = new THREE.DirectionalLight(0xfff2dc, 2.2);
  key.position.set(i2m(140), i2m(220), i2m(120));
  key.castShadow = true;
  key.shadow.mapSize.setScalar(1024);
  const kc = key.shadow.camera;
  kc.left = kc.bottom = -8;
  kc.right = kc.top = 8;
  kc.near = 1;
  kc.far = 20;
  scene.add(key);

  const itemsGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  scene.add(itemsGroup, overlayGroup);

  const topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  topCam.position.set(0, i2m(400), 0);
  topCam.up.set(0, 0, -1); // +z (south) reads downward, matching the floor plan
  topCam.lookAt(0, 0, 0);

  const mkSide = (): THREE.OrthographicCamera => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  const sideCams = { N: mkSide(), E: mkSide(), S: mkSide(), W: mkSide() };

  const topView = { cx: 0, cz: 0, spanIn: 280 };
  const frame = (
    bbox: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
    aspects?: { top: number; N: number; E: number; S: number; W: number },
  ): void => {
    const b = bbox ?? { minX: -60, maxX: 60, minZ: -40, maxZ: 40 };
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const spanX = Math.max(b.maxX - b.minX, 48);
    const spanZ = Math.max(b.maxZ - b.minZ, 48);
    // top view: fit the group + working margin (square viewport assumed)
    const halfIn = Math.max(spanX, spanZ) / 2 + 70;
    const half = i2m(halfIn);
    topCam.left = -half;
    topCam.right = half;
    topCam.top = half;
    topCam.bottom = -half;
    topCam.position.set(i2m(cx), i2m(400), i2m(cz));
    topCam.lookAt(i2m(cx), 0, i2m(cz));
    topCam.updateProjectionMatrix();
    topView.cx = cx;
    topView.cz = cz;
    topView.spanIn = halfIn * 2;

    // elevations: floor (−2") up; width follows the viewport aspect so the
    // hem-to-floor gap always reads at true proportion
    const setup = (
      cam: THREE.OrthographicCamera,
      px: number,
      pz: number,
      faceSpan: number,
      aspect: number,
    ): void => {
      const hwIn = Math.max(faceSpan / 2 + 44, (42 * aspect) / 2);
      const vspanIn = (2 * hwIn) / aspect;
      cam.left = -i2m(hwIn);
      cam.right = i2m(hwIn);
      // frustum measured from the camera axis: keep the axis on the floor so
      // the view spans world y ∈ [−2, vspan−2] — hem and floor always visible
      cam.bottom = i2m(-2);
      cam.top = i2m(vspanIn - 2);
      cam.position.set(i2m(px), 0, i2m(pz));
      cam.lookAt(i2m(cx), 0, i2m(cz));
      cam.updateProjectionMatrix();
    };
    const D = 220; // camera pull-back (inches)
    const asp = aspects ?? { top: 1, N: 3, E: 3, S: 3, W: 3 };
    setup(sideCams.N, cx, b.minZ - D, spanX, asp.N);
    setup(sideCams.S, cx, b.maxZ + D, spanX, asp.S);
    setup(sideCams.W, b.minX - D, cz, spanZ, asp.W);
    setup(sideCams.E, b.maxX + D, cz, spanZ, asp.E);
  };
  frame(null);

  return {
    scene,
    itemsGroup,
    overlayGroup,
    topCam,
    sideCams,
    frame,
    topView,
    dispose() {
      wood.map.dispose();
      wood.roughnessMap.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
    },
  };
}
