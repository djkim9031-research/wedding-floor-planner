import * as THREE from 'three';
import { pbrOf } from '../tags';

/** Auxiliary buffers for the AI denoiser: first-hit albedo and world normal,
 * rasterized from the path-traced scene at the path tracer's resolution.
 * Rows stay bottom-up (GL order) — the same order as the color buffer. */
export class AovRenderer {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly albedoMats = new Map<string, THREE.Material>();
  private readonly normalMat = new THREE.MeshNormalMaterial();
  private readonly worldNormalMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }`,
    side: THREE.DoubleSide,
  });

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  private ensure(w: number, h: number): THREE.WebGLRenderTarget {
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
    }
    return this.target;
  }

  private albedoFor(mat: THREE.Material): THREE.Material {
    let m = this.albedoMats.get(mat.uuid);
    if (!m) {
      const src = mat as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
      const role = pbrOf(mat)?.role ?? 'generic';
      const glass = role.startsWith('glass') || (src.transmission ?? 0) > 0.5;
      const emitter = role.startsWith('emitter') || role === 'backplate';
      m = new THREE.MeshBasicMaterial({
        color: glass ? 0xffffff : emitter ? src.emissive ?? src.color : src.color,
        map: glass ? null : emitter ? (src.emissiveMap ?? src.map ?? null) : (src.map ?? null),
        vertexColors: src.vertexColors,
        alphaTest: src.alphaTest,
        alphaMap: src.alphaMap ?? null,
        side: src.side,
        toneMapped: false,
      });
      this.albedoMats.set(mat.uuid, m);
    }
    return m;
  }

  /** Render [albedo, normal] as RGBA8 (GL row order). */
  render(scene: THREE.Scene, camera: THREE.Camera, w: number, h: number): { albedo: Uint8ClampedArray<ArrayBuffer>; normal: Uint8ClampedArray<ArrayBuffer> } {
    const r = this.renderer;
    const rt = this.ensure(w, h);
    const prevTarget = r.getRenderTarget();
    const prevBg = scene.background;
    const prevTone = r.toneMapping;
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    r.toneMapping = THREE.NoToneMapping;
    scene.background = null;

    const swap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) swap.set(mesh, mesh.material);
    });

    const read = (): Uint8ClampedArray<ArrayBuffer> => {
      const buf = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      return new Uint8ClampedArray(buf.buffer);
    };

    // albedo — sky pixels read as white
    for (const [mesh, mat] of swap) mesh.material = Array.isArray(mat) ? mat.map((m) => this.albedoFor(m)) : this.albedoFor(mat);
    r.setRenderTarget(rt);
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(scene, camera);
    const albedo = read();

    // world normals — sky pixels face the camera
    for (const mesh of swap.keys()) mesh.material = this.worldNormalMat;
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, camera);
    const normal = read();

    for (const [mesh, mat] of swap) mesh.material = mat;
    scene.background = prevBg;
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.toneMapping = prevTone;
    return { albedo, normal };
  }

  dispose(): void {
    this.target?.dispose();
    for (const m of this.albedoMats.values()) m.dispose();
    this.albedoMats.clear();
    this.normalMat.dispose();
    this.worldNormalMat.dispose();
  }
}
