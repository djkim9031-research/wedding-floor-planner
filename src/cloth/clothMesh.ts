import * as THREE from 'three';
import { mulberry32 } from './prng';

// ---------------------------------------------------------------------------
// Shared linen resources (canvas weave textures + one material per color)
// ---------------------------------------------------------------------------

const WEAVE_TILE_IN = 8; // one texture tile covers 8" of fabric

let weaveMap: THREE.CanvasTexture | null = null;
let weaveBump: THREE.CanvasTexture | null = null;
const materials = new Map<number, THREE.MeshPhysicalMaterial>();

function makeWeaveCanvas(bump: boolean): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bump ? '#808080' : '#f4f1ea';
  ctx.fillRect(0, 0, size, size);

  const rng = mulberry32(0x1e7e5);
  const thread = 4;
  for (let ty = 0; ty < size / thread; ty++) {
    for (let tx = 0; tx < size / thread; tx++) {
      const over = (tx + ty) % 2 === 0; // plain-weave checker
      const jitter = (rng() - 0.5) * 10;
      const v = bump ? (over ? 148 : 108) + jitter : (over ? 244 : 233) + jitter;
      const c = Math.max(0, Math.min(255, Math.round(v)));
      ctx.fillStyle = `rgb(${c},${c},${bump ? c : Math.max(0, c - 6)})`;
      ctx.fillRect(tx * thread, ty * thread, thread, thread);
    }
  }
  // thread gaps
  ctx.fillStyle = bump ? 'rgba(60,60,60,0.5)' : 'rgba(190,183,168,0.35)';
  for (let k = 0; k < size; k += thread) {
    ctx.fillRect(k, 0, 1, size);
    ctx.fillRect(0, k, size, 1);
  }
  return canvas;
}

function ensureTextures(): void {
  if (weaveMap) return;
  weaveMap = new THREE.CanvasTexture(makeWeaveCanvas(false));
  weaveMap.wrapS = weaveMap.wrapT = THREE.RepeatWrapping;
  weaveMap.colorSpace = THREE.SRGBColorSpace;
  weaveBump = new THREE.CanvasTexture(makeWeaveCanvas(true));
  weaveBump.wrapS = weaveBump.wrapT = THREE.RepeatWrapping;
}

export function getClothMaterial(color: number): THREE.MeshPhysicalMaterial {
  let mat = materials.get(color);
  if (!mat) {
    ensureTextures();
    mat = new THREE.MeshPhysicalMaterial({
      color,
      map: weaveMap,
      bumpMap: weaveBump,
      bumpScale: 0.6,
      roughness: 0.9,
      metalness: 0,
      sheen: 0.6,
      sheenRoughness: 0.65,
      sheenColor: 0xfff8ec,
      side: THREE.DoubleSide,
      shadowSide: THREE.FrontSide,
    });
    materials.set(color, mat);
  }
  return mat;
}

/** Dispose the shared material/texture cache (manager teardown). */
export function disposeClothResources(): void {
  for (const m of materials.values()) m.dispose();
  materials.clear();
  weaveMap?.dispose();
  weaveBump?.dispose();
  weaveMap = null;
  weaveBump = null;
}

// ---------------------------------------------------------------------------
// Render mesh: sim grid, optionally Catmull-Rom 2×-subdivided per frame
// ---------------------------------------------------------------------------

function buildGridIndex(nx: number, nz: number): THREE.BufferAttribute {
  const tris = (nx - 1) * (nz - 1) * 2;
  const idx = nx * nz > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  let k = 0;
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = ix + iz * nx;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}

/** UVs in weave-tile units (texture repeats every WEAVE_TILE_IN inches). */
function buildGridUVs(nx: number, nz: number, sx: number, sz: number): THREE.BufferAttribute {
  const uv = new Float32Array(nx * nz * 2);
  let k = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      uv[k++] = (ix * sx) / WEAVE_TILE_IN;
      uv[k++] = (iz * sz) / WEAVE_TILE_IN;
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}

/** Catmull-Rom midpoint with clamped ends: (-a + 9b + 9c - d) / 16. */
function crMid(a: number, b: number, c: number, d: number): number {
  return (-a + 9 * b + 9 * c - d) * 0.0625;
}

export class ClothRenderMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly simPos: Float32Array;
  private readonly nx: number;
  private readonly nz: number;
  private readonly subdivide: boolean;
  private readonly rnx: number = 0;
  private readonly rnz: number = 0;
  private readonly rowTemp: Float32Array | null = null; // rnx × nz expansion
  private readonly outPos: Float32Array | null = null;

  /** invoked on the refined vertex buffer before normals (fine tier only) */
  clamp: ((pos: Float32Array, count: number) => void) | null = null;

  constructor(
    simPos: Float32Array,
    nx: number,
    nz: number,
    sx: number,
    sz: number,
    color: number,
    subdivide: boolean
  ) {
    this.simPos = simPos;
    this.nx = nx;
    this.nz = nz;
    this.subdivide = subdivide;
    this.geometry = new THREE.BufferGeometry();

    if (subdivide) {
      this.rnx = nx * 2 - 1;
      this.rnz = nz * 2 - 1;
      this.rowTemp = new Float32Array(this.rnx * nz * 3);
      this.outPos = new Float32Array(this.rnx * this.rnz * 3);
      this.posAttr = new THREE.BufferAttribute(this.outPos, 3);
      this.geometry.setIndex(buildGridIndex(this.rnx, this.rnz));
      this.geometry.setAttribute('uv', buildGridUVs(this.rnx, this.rnz, sx / 2, sz / 2));
    } else {
      // sim positions ARE the render attribute — zero copy
      this.posAttr = new THREE.BufferAttribute(simPos, 3);
      this.geometry.setIndex(buildGridIndex(nx, nz));
      this.geometry.setAttribute('uv', buildGridUVs(nx, nz, sx, sz));
    }
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);

    this.mesh = new THREE.Mesh(this.geometry, getClothMaterial(color));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // positions move in world-inch space
    this.update();
  }

  /** Push current sim positions to the GPU (subdividing on the fine tier). */
  update(): void {
    if (this.subdivide) {
      this.refine();
      this.clamp?.(this.outPos!, this.rnx * this.rnz);
    }
    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  private refine(): void {
    const { simPos, nx, nz, rnx, rnz } = this;
    const rows = this.rowTemp!;
    const out = this.outPos!;
    // pass 1: expand along x for every sim row
    for (let iz = 0; iz < nz; iz++) {
      const src = iz * nx * 3;
      const dst = iz * rnx * 3;
      for (let ix = 0; ix < nx; ix++) {
        const s = src + ix * 3;
        const d = dst + ix * 6;
        rows[d] = simPos[s];
        rows[d + 1] = simPos[s + 1];
        rows[d + 2] = simPos[s + 2];
        if (ix < nx - 1) {
          const i0 = src + (ix > 0 ? ix - 1 : 0) * 3;
          const i1 = s;
          const i2 = s + 3;
          const i3 = src + (ix < nx - 2 ? ix + 2 : nx - 1) * 3;
          rows[d + 3] = crMid(simPos[i0], simPos[i1], simPos[i2], simPos[i3]);
          rows[d + 4] = crMid(simPos[i0 + 1], simPos[i1 + 1], simPos[i2 + 1], simPos[i3 + 1]);
          rows[d + 5] = crMid(simPos[i0 + 2], simPos[i1 + 2], simPos[i2 + 2], simPos[i3 + 2]);
        }
      }
    }
    // pass 2: expand along z for every refined column
    const rowStride = rnx * 3;
    for (let iz = 0; iz < nz; iz++) {
      out.set(rows.subarray(iz * rowStride, (iz + 1) * rowStride), iz * 2 * rowStride);
    }
    for (let iz = 0; iz < nz - 1; iz++) {
      const r0 = (iz > 0 ? iz - 1 : 0) * rowStride;
      const r1 = iz * rowStride;
      const r2 = (iz + 1) * rowStride;
      const r3 = (iz < nz - 2 ? iz + 2 : nz - 1) * rowStride;
      const dst = (iz * 2 + 1) * rowStride;
      for (let k = 0; k < rowStride; k++) {
        out[dst + k] = crMid(rows[r0 + k], rows[r1 + k], rows[r2 + k], rows[r3 + k]);
      }
    }
  }

  dispose(): void {
    this.geometry.dispose(); // material is shared; disposed via disposeClothResources()
  }
}
