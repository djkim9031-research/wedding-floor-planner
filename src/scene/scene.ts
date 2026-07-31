import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { applyAtmosphere, buildExterior } from './exterior';
import { setupLighting } from './lighting';
import { buildVenue } from './venue';

export interface SceneHost {
  renderer: THREE.WebGLRenderer;
  css2d: CSS2DRenderer;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  /** parent for placed-item meshes and the cloth manager's group */
  itemsGroup: THREE.Group;
  /** parent for ghost, snap highlights, dimension lines, rotate ring */
  overlayGroup: THREE.Group;
  roof: THREE.Group;
  setRoofVisible(v: boolean): void;
  roofVisible(): boolean;
  invalidate(): void;
  invalidateShadows(): void;
  /** drive the lighting from a real sun state; null = showcase preset */
  applySun(input: import('./lighting').SunInput | null): void;
  /** cb runs every frame; return true to request a render (e.g. cloth settling) */
  onFrame(cb: (dt: number) => boolean | void): void;
  /** begin the loop; `update` is the camera rig tick returning "camera moved" */
  start(camera: THREE.PerspectiveCamera, update: (dt: number) => boolean): void;
}

export function createSceneHost(container: HTMLElement): SceneHost {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'gl-canvas';

  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'css2d-layer';
  container.appendChild(css2d.domElement);

  const scene = new THREE.Scene();

  const venue = buildVenue();
  scene.add(venue.group);
  scene.add(buildExterior());
  const atmo = applyAtmosphere(scene);
  const lighting = setupLighting(scene, renderer, atmo);

  const itemsGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  scene.add(itemsGroup, overlayGroup);

  // Sims-style: start with the roof off so the bird's-eye view reads instantly.
  venue.roof.visible = false;

  let dirty = true;
  const frameCbs: Array<(dt: number) => boolean | void> = [];

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    css2d.setSize(w, h);
    dirty = true;
  };
  new ResizeObserver(resize).observe(container);

  const host: SceneHost = {
    renderer,
    css2d,
    scene,
    canvas: renderer.domElement,
    itemsGroup,
    overlayGroup,
    roof: venue.roof,
    setRoofVisible(v) {
      venue.roof.visible = v;
      lighting.invalidateShadows();
      dirty = true;
    },
    roofVisible: () => venue.roof.visible,
    invalidate() {
      dirty = true;
    },
    invalidateShadows() {
      lighting.invalidateShadows();
      dirty = true;
    },
    applySun(input) {
      lighting.applySun(input);
      dirty = true;
    },
    onFrame(cb) {
      frameCbs.push(cb);
    },
    start(camera, update) {
      resize();
      let last = performance.now();
      const tick = (now: number) => {
        requestAnimationFrame(tick);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        const camMoved = update(dt);
        let simActive = false;
        for (const cb of frameCbs) {
          if (cb(dt)) simActive = true;
        }
        if (dirty || camMoved || simActive) {
          if (simActive) renderer.shadowMap.needsUpdate = true;
          renderer.render(scene, camera);
          css2d.render(scene, camera);
          dirty = false;
        }
      };
      requestAnimationFrame(tick);
    },
  };
  return host;
}
