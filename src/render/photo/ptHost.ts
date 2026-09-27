import * as THREE from 'three';
import { PhysicalCamera, WebGLPathTracer } from 'three-gpu-pathtracer';
import type { SkyState } from '../../sky/types';
import type { RenderSceneResult } from '../types';
import type { PtPreset } from './gpuTier';
import { equirectTexture } from './skyTextures';

export interface DofSettings {
  enabled: boolean;
  focusM: number;
  fStop: number;
}

/** Owns one WebGLPathTracer bound to the host renderer and a render-only
 * scene. Camera and sky changes are cheap (no BVH rebuild); geometry changes
 * need a new scene. */
export class PtHost {
  readonly pt: WebGLPathTracer;
  readonly camera = new PhysicalCamera(50, 1, 0.05, 2000);
  private env: THREE.DataTexture | null = null;
  private bg: THREE.DataTexture | null = null;
  private built: RenderSceneResult | null = null;
  private readonly lastCam = new THREE.Matrix4();
  private lastFov = 0;
  private lastAspect = 0;
  private dof: DofSettings = { enabled: false, focusM: 5, fStop: 2.8 };
  setSceneMs = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly preset: PtPreset,
  ) {
    const pt = new WebGLPathTracer(renderer);
    pt.renderScale = preset.renderScale;
    pt.tiles.set(preset.tiles, preset.tiles);
    pt.bounces = preset.bounces;
    pt.transmissiveBounces = preset.transmissiveBounces;
    pt.textureSize.set(preset.textureSize, preset.textureSize);
    pt.filterGlossyFactor = 0.5; // tame diffuse→specular fireflies
    pt.minSamples = 1;
    pt.renderDelay = 0;
    pt.fadeDuration = 250;
    pt.dynamicLowRes = true;
    pt.lowResScale = 0.25;
    this.pt = pt;
  }

  get scene(): THREE.Scene | null {
    return this.built?.scene ?? null;
  }

  get samples(): number {
    return this.pt.samples;
  }

  /** Bind a freshly built render scene (expensive: BVH build + shader compile). */
  load(built: RenderSceneResult, sky: SkyState, src: THREE.PerspectiveCamera): void {
    this.built?.dispose();
    this.built = built;
    this.applySky(sky, false);
    this.copyCamera(src);
    const t0 = performance.now();
    this.pt.setScene(built.scene, this.camera);
    this.setSceneMs = performance.now() - t0;
  }

  /** Mirror the rig camera; returns true when the view changed. */
  syncCamera(src: THREE.PerspectiveCamera): boolean {
    src.updateMatrixWorld();
    if (src.matrixWorld.equals(this.lastCam) && src.fov === this.lastFov && src.aspect === this.lastAspect) return false;
    this.copyCamera(src);
    this.pt.updateCamera();
    return true;
  }

  private copyCamera(src: THREE.PerspectiveCamera): void {
    src.updateMatrixWorld();
    const c = this.camera;
    c.position.copy(src.position);
    c.quaternion.copy(src.quaternion);
    c.fov = src.fov;
    c.aspect = src.aspect;
    c.near = 0.05;
    c.far = 2000;
    c.fStop = this.dof.enabled ? this.dof.fStop : 1e4;
    c.focusDistance = this.dof.focusM;
    c.apertureBlades = this.dof.enabled ? 7 : 0;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.lastCam.copy(src.matrixWorld);
    this.lastFov = src.fov;
    this.lastAspect = src.aspect;
  }

  setDof(d: Partial<DofSettings>, src: THREE.PerspectiveCamera): void {
    this.dof = { ...this.dof, ...d };
    this.copyCamera(src);
    this.pt.updateCamera();
  }

  getDof(): DofSettings {
    return { ...this.dof };
  }

  /** Sky radiance + sun/moon lights for a new time of day. */
  applySky(sky: SkyState, notify = true): void {
    const scene = this.built?.scene;
    if (!scene) return;
    this.env = equirectTexture(sky.env, this.env);
    this.bg = equirectTexture(sky.bg, this.bg);
    scene.environment = this.env;
    scene.background = this.bg;
    scene.environmentIntensity = 1;
    scene.backgroundIntensity = 1;
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined;
    if (sun?.isDirectionalLight) {
      const d = sky.sun.dir;
      sun.position.set(d[0], d[1], d[2]).multiplyScalar(100);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
      sun.color.setRGB(...sky.sun.colorLinear, THREE.LinearSRGBColorSpace);
      sun.intensity = sky.sun.illuminanceLux;
      sun.visible = sky.sun.illuminanceLux > 0;
      sun.updateMatrixWorld();
    }
    const moon = scene.getObjectByName('moon') as THREE.DirectionalLight | undefined;
    if (moon?.isDirectionalLight) {
      const d = sky.moon.dir;
      moon.position.set(d[0], d[1], d[2]).multiplyScalar(100);
      moon.intensity = sky.moon.illuminanceLux;
      moon.visible = sky.moon.illuminanceLux > 0;
      moon.updateMatrixWorld();
    }
    if (notify) {
      this.pt.updateEnvironment();
      this.pt.updateLights();
    }
  }

  renderSample(): void {
    this.pt.renderSample();
  }

  reset(): void {
    this.pt.reset();
  }

  /** Current accumulated radiance (linear float RGBA, GL rows). */
  readRadiance(): { data: Float32Array; width: number; height: number } {
    const target = this.pt.target;
    const w = target.width;
    const h = target.height;
    const data = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, data);
    return { data, width: w, height: h };
  }

  dispose(): void {
    this.pt.dispose();
    this.built?.dispose();
    this.built = null;
    this.env?.dispose();
    this.bg?.dispose();
  }
}
