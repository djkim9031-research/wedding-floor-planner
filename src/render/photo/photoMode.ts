import * as THREE from 'three';
import { appContext, settleCloth } from '../../app/context';
import { creatorIsOpen } from '../../creator/creatorWindow';
import { exposureScale } from '../../sky/exposure';
import { getSky, subscribeSky } from '../../sky/skyStore';
import { getViewEV100 } from '../../sky/viewExposure';
import * as store from '../../state/store';
import { buildRenderScene } from '../renderScene';
import { AovRenderer } from './aov';
import { denoise, webgpuAvailable } from './denoise';
import { presetFor, type PtPreset } from './gpuTier';
import { PtHost } from './ptHost';
import { photoFileName, saveBlob } from './save';
import { agxToImage, imageToPng } from './tonemap';

/** Photo mode: the live view becomes a progressive path-traced render.
 * View-only — orbiting, walking, date/time, exposure and focus keep refining;
 * any edit to the layout drops back to the editor (a new scene would need a
 * full BVH rebuild). */

export type PhotoPhase = 'off' | 'preparing' | 'rendering' | 'denoising' | 'done' | 'saving';

export interface PhotoStatus {
  phase: PhotoPhase;
  samples: number;
  maxSamples: number;
  sps: number;
  elapsedS: number;
  denoised: boolean;
  denoiser: 'oidn' | 'none';
  gpu: string;
  tier: string;
  setSceneMs: number;
  triangles: number;
  message?: string;
}

type Listener = (s: PhotoStatus) => void;

class PhotoMode {
  private pt: PtHost | null = null;
  private aov: AovRenderer | null = null;
  private preset: PtPreset | null = null;
  private status: PhotoStatus = this.blank();
  private listeners = new Set<Listener>();
  private unsubs: Array<() => void> = [];
  private startT = 0;
  private lastSampleT = 0;
  private lastSamples = 0;
  private denoised: THREE.DataTexture | null = null;
  private denoiseAbort: AbortController | null = null;
  private quad: THREE.Mesh | null = null;
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private denoiseEnabled = true;
  private prevToneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping;
  private prevExposure = 1;
  private capture: { longEdge: number; resolve: (b: Blob | null) => void } | null = null;
  private busy = false;

  private blank(): PhotoStatus {
    return {
      phase: 'off',
      samples: 0,
      maxSamples: 0,
      sps: 0,
      elapsedS: 0,
      denoised: false,
      denoiser: webgpuAvailable() ? 'oidn' : 'none',
      gpu: '',
      tier: '',
      setSceneMs: 0,
      triangles: 0,
    };
  }

  get active(): boolean {
    return this.status.phase !== 'off';
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<PhotoStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  toggle(): void {
    if (this.active) this.exit();
    else void this.enter();
  }

  async enter(): Promise<void> {
    if (this.active) return;
    const ctx = appContext();
    if (creatorIsOpen()) {
      ctx.toast('Close the Table Setup Creator first');
      return;
    }
    ctx.fsm.cancel();
    this.emit({ ...this.blank(), phase: 'preparing', message: 'Settling linens…' });
    await settleCloth();
    if (this.status.phase !== 'preparing') return; // exited meanwhile

    const { host, clothMgr } = ctx;
    const renderer = host.renderer;
    const camera = host.getCamera();
    if (!camera) return;
    this.preset = presetFor(renderer);
    this.emit({ message: 'Building the scene…', gpu: this.preset.gpu, tier: this.preset.tier, maxSamples: this.preset.maxSamples });
    host.setOverlaysVisible(false);
    await nextFrame();

    try {
      const sky = getSky();
      const built = buildRenderScene(host, clothMgr, { target: 'pathtracer', includeRoof: this.wantsRoof(camera), sky });
      this.emit({ message: 'Compiling the path tracer…', triangles: built.stats.triangles });
      await nextFrame();
      this.pt = new PtHost(renderer, this.preset);
      this.pt.load(built, sky, camera);
      this.pt.pt.rasterizeSceneCallback = () => host.rasterize(camera, { overlays: false });
      this.aov = new AovRenderer(renderer);
    } catch (e) {
      console.error(e);
      this.exit();
      const pending = e instanceof Error && /not available yet/.test(e.message);
      ctx.toast(pending ? 'Photo mode is still being wired up — coming in a later build' : 'Photo mode is not available on this device');
      return;
    }

    this.prevToneMapping = renderer.toneMapping;
    this.prevExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.AgXToneMapping;
    this.applyExposure();

    this.unsubs.push(
      store.subscribe((_s, ev) => {
        if (ev.kind === 'items' || ev.kind === 'load') {
          this.exit();
          ctx.toast('Edited — back to the editor');
        }
      }),
      subscribeSky((s) => {
        if (!this.pt) return;
        this.pt.applySky(s);
        this.applyExposure();
        this.restart();
      }),
    );
    const onLost = () => {
      this.exit();
      ctx.toast('The GPU reset — Photo mode stopped');
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost, { once: true });
    this.unsubs.push(() => renderer.domElement.removeEventListener('webglcontextlost', onLost));

    this.startT = performance.now();
    this.lastSampleT = this.startT;
    this.lastSamples = 0;
    this.emit({ phase: 'rendering', message: undefined, setSceneMs: this.pt.setSceneMs });
    host.setRenderOverride((f) => this.frame(f.camera, f.camMoved, f.dirty));
  }

  exit(): void {
    if (this.status.phase === 'off') return;
    this.denoiseAbort?.abort();
    for (const u of this.unsubs.splice(0)) u();
    let ctx: ReturnType<typeof appContext> | null = null;
    try {
      ctx = appContext();
    } catch {
      /* not booted */
    }
    if (ctx) {
      ctx.host.setRenderOverride(null);
      ctx.host.setOverlaysVisible(true);
      if (this.pt) {
        ctx.host.renderer.toneMapping = this.prevToneMapping;
        ctx.host.renderer.toneMappingExposure = this.prevExposure;
      }
      ctx.host.invalidate();
    }
    this.pt?.dispose();
    this.pt = null;
    this.aov?.dispose();
    this.aov = null;
    this.clearDenoised();
    this.capture?.resolve(null);
    this.capture = null;
    this.emit({ ...this.blank() });
  }

  private wantsRoof(camera: THREE.PerspectiveCamera): boolean {
    const { host } = appContext();
    if (host.roofVisible()) return true;
    // eye-level views inside the hall need the ceiling to be lit correctly
    return camera.position.y < 4.5;
  }

  private applyExposure(): void {
    if (!this.pt) return;
    const { host } = appContext();
    host.renderer.toneMappingExposure = exposureScale(viewEV());
  }

  private restart(): void {
    this.denoiseAbort?.abort();
    this.busy = false;
    this.clearDenoised();
    this.startT = performance.now();
    this.lastSampleT = this.startT;
    this.lastSamples = 0;
    if (this.status.phase !== 'saving') this.emit({ phase: 'rendering', samples: 0, denoised: false });
  }

  private clearDenoised(): void {
    this.denoised?.dispose();
    this.denoised = null;
  }

  setDenoise(on: boolean): void {
    this.denoiseEnabled = on;
    if (!on) {
      this.clearDenoised();
      this.emit({ denoised: false, phase: this.status.phase === 'done' ? 'rendering' : this.status.phase });
    }
  }

  setDof(d: { enabled?: boolean; focusM?: number; fStop?: number }): void {
    const cam = appContext().host.getCamera();
    if (!this.pt || !cam) return;
    this.pt.setDof(d, cam);
    this.restart();
  }

  getDof(): { enabled: boolean; focusM: number; fStop: number } | null {
    return this.pt?.getDof() ?? null;
  }

  /** Focus distance from a click on the canvas (raycast into the render scene). */
  focusAt(ndcX: number, ndcY: number): void {
    const cam = appContext().host.getCamera();
    const scene = this.pt?.scene;
    if (!cam || !scene) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const hit = ray.intersectObjects(scene.children, true)[0];
    if (hit) this.setDof({ enabled: true, focusM: hit.distance });
  }

  private frame(camera: THREE.PerspectiveCamera, _camMoved: boolean, dirty: boolean): void {
    const pt = this.pt;
    const preset = this.preset;
    if (!pt || !preset) return;
    const { host } = appContext();
    if (pt.syncCamera(camera)) this.restart();
    if (this.denoised) {
      if (dirty) this.drawDenoised(); // denoised frame otherwise stays on screen
      return;
    }
    const goal = this.capture ? Math.max(preset.maxSamples, 256) : preset.denoiseAt;
    const cap = this.capture ? goal : preset.maxSamples;
    if (pt.samples < cap || dirty) {
      pt.renderSample();
      host.css2d.domElement.style.visibility = 'hidden';
    }
    const now = performance.now();
    if (now - this.lastSampleT > 500) {
      const sps = ((pt.samples - this.lastSamples) * 1000) / (now - this.lastSampleT);
      this.lastSampleT = now;
      this.lastSamples = pt.samples;
      this.emit({ samples: Math.floor(pt.samples), sps, elapsedS: (now - this.startT) / 1000 });
    }
    const ready = this.status.phase === 'rendering' || (this.status.phase === 'saving' && !!this.capture);
    if (pt.samples >= goal && ready && !this.busy) {
      this.busy = true;
      if (this.denoiseEnabled && this.status.denoiser === 'oidn') void this.runDenoise(this.capture ? 'full' : 'small');
      else this.finish(null);
    }
  }

  private async runDenoise(kind: 'small' | 'full'): Promise<void> {
    const pt = this.pt;
    const scene = pt?.scene;
    const cam = appContext().host.getCamera();
    if (!pt || !scene || !cam || !this.aov) return;
    const saving = this.status.phase === 'saving';
    this.emit({ phase: saving ? 'saving' : 'denoising', message: 'Denoising…' });
    this.denoiseAbort = new AbortController();
    const signal = this.denoiseAbort.signal;
    const rad = pt.readRadiance();
    const aov = this.aov.render(scene, pt.camera, rad.width, rad.height);
    const t0 = performance.now();
    const out = await denoise(
      { color: rad.data, albedo: aov.albedo, normal: aov.normal, width: rad.width, height: rad.height, scale: exposureScale(viewEV()), kind },
      signal,
    );
    if (signal.aborted || this.pt !== pt) {
      this.busy = false;
      return;
    }
    console.info(`denoise ${kind} ${rad.width}×${rad.height} ${Math.round(performance.now() - t0)} ms`);
    if (!out) {
      this.emit({ denoiser: 'none' });
      this.finish(rad.data, rad.width, rad.height);
      return;
    }
    this.clearDenoised();
    this.denoised = new THREE.DataTexture(out, rad.width, rad.height, THREE.RGBAFormat, THREE.FloatType);
    this.denoised.colorSpace = THREE.LinearSRGBColorSpace;
    this.denoised.minFilter = THREE.LinearFilter;
    this.denoised.magFilter = THREE.LinearFilter;
    this.denoised.needsUpdate = true;
    this.drawDenoised();
    this.finish(out, rad.width, rad.height);
  }

  private finish(data: Float32Array | null, w?: number, h?: number): void {
    this.busy = false;
    this.emit({ phase: 'done', denoised: !!this.denoised, message: undefined });
    if (this.capture && this.pt) {
      const cap = this.capture;
      this.capture = null;
      const img = data && w && h ? { data, width: w, height: h } : this.pt.readRadiance();
      const px = agxToImage(img.data, img.width, img.height, exposureScale(viewEV()));
      this.pt.pt.renderScale = this.preset!.renderScale;
      void imageToPng(px, img.width, img.height).then(cap.resolve, () => cap.resolve(null));
    }
  }

  private drawDenoised(): void {
    if (!this.denoised) return;
    const { host } = appContext();
    if (!this.quad) {
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ toneMapped: true, depthTest: false, depthWrite: false }));
      this.quad.frustumCulled = false;
    }
    const mat = this.quad.material as THREE.MeshBasicMaterial;
    mat.map = this.denoised;
    mat.needsUpdate = true;
    const r = host.renderer;
    r.setRenderTarget(null);
    r.render(this.quad, this.quadCam);
  }

  /** Render at a target long edge, denoise, and resolve with a PNG. */
  async savePhoto(longEdge?: number): Promise<void> {
    const ctx = appContext();
    if (!this.pt || !this.preset) {
      ctx.toast('Enter Photo mode first (P)');
      return;
    }
    const r = ctx.host.renderer;
    const size = new THREE.Vector2();
    r.getDrawingBufferSize(size);
    if (longEdge) {
      const scale = Math.min(longEdge / Math.max(size.x, size.y), 4096 / Math.max(size.x, size.y));
      this.pt.pt.renderScale = scale;
    }
    const blobP = new Promise<Blob | null>((resolve) => (this.capture = { longEdge: longEdge ?? 0, resolve }));
    if (longEdge) this.pt.reset();
    this.clearDenoised();
    this.emit({ phase: 'saving', message: 'Rendering the photo…' });
    this.busy = false; // the frame loop picks the capture up once enough samples accumulate
    const blob = await blobP;
    if (!blob) return;
    const inp = getSky().input;
    const name = photoFileName(inp.date, inp.minutes, longEdge ? `-${longEdge}` : '');
    const saved = await saveBlob(blob, name);
    if (saved) ctx.toast(`Saved ${name}`);
    if (longEdge) this.restart();
  }
}

/** the exposure the live view uses (interior metering, auto EV, comp) */
function viewEV(): number {
  return getViewEV100() ?? getSky().ev100;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export const photoMode = new PhotoMode();
