import * as THREE from 'three';

/** Attribute normalization for the render builder.
 *
 * three-gpu-pathtracer 0.0.24 merges every mesh into one geometry: its
 * `mergeGeometries` throws unless all inputs carry the same attribute set,
 * and `copyAttributeContents` copies raw typed arrays (no denormalization, no
 * itemSize conversion). So every render geometry is rebuilt as exactly
 *   position(3, f32) · normal(3, f32) · uv(2, f32) · color(4, f32) + Uint32 index
 * with no groups. glTF output uses the same layout minus color when the
 * material ignores vertex colors. */

export const RENDER_ATTRIBUTES = ['position', 'normal', 'uv', 'color'] as const;

export interface NormalizeOptions {
  /** bake this transform (positions, normals; winding flipped when det < 0) */
  matrix?: THREE.Matrix4;
  /** expand to independent triangles with face normals (glTF flatShading) */
  flat?: boolean;
  /** emit color(4) — default true */
  color?: boolean;
  /** element range to keep (index units, or vertex units when non-indexed);
   * used to split material groups. Defaults to the geometry's drawRange. */
  range?: { start: number; count: number };
}

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function isFastFloat(a: Attr): a is THREE.BufferAttribute {
  return !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized;
}

/** Read component `c` of element `i` (handles interleaved + normalized). */
function comp(a: Attr, i: number, c: number): number {
  switch (c) {
    case 0:
      return a.getX(i);
    case 1:
      return a.getY(i);
    case 2:
      return a.getZ(i);
    default:
      return a.getW(i);
  }
}

/** Element list (vertex ids per triangle corner) for a range. */
function elementsOf(src: THREE.BufferGeometry, range?: { start: number; count: number }): { ids: Uint32Array; full: boolean } {
  const index = src.index;
  const total = index ? index.count : (src.getAttribute('position')?.count ?? 0);
  const dr = src.drawRange;
  let start = range ? range.start : dr.start;
  let end = range ? range.start + range.count : dr.count === Infinity ? total : dr.start + dr.count;
  start = Math.max(0, Math.min(start, total));
  end = Math.max(start, Math.min(end, total));
  end = start + Math.floor((end - start) / 3) * 3; // whole triangles only
  const n = end - start;
  const ids = new Uint32Array(n);
  if (index) {
    const arr = index.array;
    for (let k = 0; k < n; k++) ids[k] = arr[start + k];
  } else {
    for (let k = 0; k < n; k++) ids[k] = start + k;
  }
  return { ids, full: start === 0 && end === total };
}

/** Rebuild `src` into the canonical render layout. Returns null for
 * geometries without positions or triangles. Never mutates `src`. */
export function normalizeGeometry(src: THREE.BufferGeometry, opts: NormalizeOptions = {}): THREE.BufferGeometry | null {
  const pos = src.getAttribute('position') as Attr | undefined;
  if (!pos || pos.count === 0) return null;
  const nrm = src.getAttribute('normal') as Attr | undefined;
  const uv = src.getAttribute('uv') as Attr | undefined;
  const col = src.getAttribute('color') as Attr | undefined;
  const wantColor = opts.color ?? true;

  const { ids, full } = elementsOf(src, opts.range);
  if (ids.length === 0) return null;

  // compact to the vertices this range references (group splits / partial
  // draw ranges); a full indexed range keeps every vertex as-is
  let remap: Int32Array | null = null;
  let vcount = pos.count;
  let srcOf: Uint32Array | null = null; // new vertex -> source vertex
  if (!full || !src.index) {
    if (src.index) {
      remap = new Int32Array(pos.count).fill(-1);
      const order: number[] = [];
      for (let k = 0; k < ids.length; k++) {
        const v = ids[k];
        if (remap[v] < 0) {
          remap[v] = order.length;
          order.push(v);
        }
      }
      srcOf = Uint32Array.from(order);
      vcount = order.length;
    } else {
      // non-indexed: the range's vertices, in order
      srcOf = ids.slice();
      vcount = ids.length;
    }
  }

  const P = new Float32Array(vcount * 3);
  const N = new Float32Array(vcount * 3);
  const U = new Float32Array(vcount * 2);
  const C = wantColor ? new Float32Array(vcount * 4) : null;
  const fastP = isFastFloat(pos) && pos.itemSize === 3 && !srcOf;
  if (fastP) P.set((pos as THREE.BufferAttribute).array as Float32Array);
  for (let v = 0; v < vcount; v++) {
    const s = srcOf ? srcOf[v] : v;
    if (!fastP) {
      P[v * 3] = pos.getX(s);
      P[v * 3 + 1] = pos.itemSize > 1 ? pos.getY(s) : 0;
      P[v * 3 + 2] = pos.itemSize > 2 ? pos.getZ(s) : 0;
    }
    if (nrm) {
      N[v * 3] = nrm.getX(s);
      N[v * 3 + 1] = nrm.getY(s);
      N[v * 3 + 2] = nrm.getZ(s);
    }
    if (uv) {
      U[v * 2] = uv.getX(s);
      U[v * 2 + 1] = uv.itemSize > 1 ? uv.getY(s) : 0;
    }
    if (C) {
      if (col) {
        C[v * 4] = comp(col, s, 0);
        C[v * 4 + 1] = col.itemSize > 1 ? comp(col, s, 1) : C[v * 4];
        C[v * 4 + 2] = col.itemSize > 2 ? comp(col, s, 2) : C[v * 4];
        C[v * 4 + 3] = col.itemSize > 3 ? comp(col, s, 3) : 1;
      } else {
        C[v * 4] = C[v * 4 + 1] = C[v * 4 + 2] = C[v * 4 + 3] = 1;
      }
    }
  }

  const I = new Uint32Array(ids.length);
  if (remap) for (let k = 0; k < ids.length; k++) I[k] = remap[ids[k]];
  else if (srcOf) for (let k = 0; k < ids.length; k++) I[k] = k;
  else I.set(ids);

  // bake the transform
  const m = opts.matrix;
  if (m && !isIdentity(m)) {
    const e = m.elements;
    for (let v = 0; v < vcount; v++) {
      const x = P[v * 3];
      const y = P[v * 3 + 1];
      const z = P[v * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
      P[v * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      P[v * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      P[v * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    }
    if (nrm) {
      const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
      for (let v = 0; v < vcount; v++) {
        const x = N[v * 3];
        const y = N[v * 3 + 1];
        const z = N[v * 3 + 2];
        N[v * 3] = nm[0] * x + nm[3] * y + nm[6] * z;
        N[v * 3 + 1] = nm[1] * x + nm[4] * y + nm[7] * z;
        N[v * 3 + 2] = nm[2] * x + nm[5] * y + nm[8] * z;
      }
    }
    if (m.determinant() < 0) {
      for (let k = 0; k < I.length; k += 3) {
        const t = I[k + 1];
        I[k + 1] = I[k + 2];
        I[k + 2] = t;
      }
    }
  }

  let out = assemble(P, N, U, C, I);
  if (opts.flat) out = flatten(out);
  else if (!nrm) out.computeVertexNormals();
  sanitize(out);
  out.name = src.name;
  return out;
}

function isIdentity(m: THREE.Matrix4): boolean {
  const e = m.elements;
  for (let i = 0; i < 16; i++) if (e[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
}

function assemble(P: Float32Array, N: Float32Array, U: Float32Array, C: Float32Array | null, I: Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(C, 4));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

/** Independent triangles with face normals (what flatShading draws) — glTF
 * has no flat-shading flag, so it has to be in the vertices. */
function flatten(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const I = g.index!.array as Uint32Array;
  const P = g.getAttribute('position').array as Float32Array;
  const U = g.getAttribute('uv').array as Float32Array;
  const Ca = g.getAttribute('color');
  const C = Ca ? (Ca.array as Float32Array) : null;
  const n = I.length;
  const P2 = new Float32Array(n * 3);
  const N2 = new Float32Array(n * 3);
  const U2 = new Float32Array(n * 2);
  const C2 = C ? new Float32Array(n * 4) : null;
  const I2 = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    const v = I[k];
    P2[k * 3] = P[v * 3];
    P2[k * 3 + 1] = P[v * 3 + 1];
    P2[k * 3 + 2] = P[v * 3 + 2];
    U2[k * 2] = U[v * 2];
    U2[k * 2 + 1] = U[v * 2 + 1];
    if (C && C2) for (let c = 0; c < 4; c++) C2[k * 4 + c] = C[v * 4 + c];
    I2[k] = k;
  }
  for (let k = 0; k < n; k += 3) {
    const ax = P2[k * 3];
    const ay = P2[k * 3 + 1];
    const az = P2[k * 3 + 2];
    const e1x = P2[k * 3 + 3] - ax;
    const e1y = P2[k * 3 + 4] - ay;
    const e1z = P2[k * 3 + 5] - az;
    const e2x = P2[k * 3 + 6] - ax;
    const e2y = P2[k * 3 + 7] - ay;
    const e2z = P2[k * 3 + 8] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let c = 0; c < 3; c++) {
      N2[(k + c) * 3] = nx;
      N2[(k + c) * 3 + 1] = ny;
      N2[(k + c) * 3 + 2] = nz;
    }
  }
  g.dispose();
  return assemble(P2, N2, U2, C2, I2);
}

/** Unit normals everywhere (the path tracer normalizes the interpolated
 * normal — a zero normal is a NaN pixel) and finite positions/uvs. */
function sanitize(g: THREE.BufferGeometry): void {
  const N = g.getAttribute('normal').array as Float32Array;
  for (let v = 0; v < N.length; v += 3) {
    const len = Math.hypot(N[v], N[v + 1], N[v + 2]);
    if (!(len > 1e-12) || !Number.isFinite(len)) {
      N[v] = 0;
      N[v + 1] = 1;
      N[v + 2] = 0;
    } else if (Math.abs(len - 1) > 1e-4) {
      N[v] /= len;
      N[v + 1] /= len;
      N[v + 2] /= len;
    }
  }
  for (const key of ['position', 'uv', 'color']) {
    const a = g.getAttribute(key);
    if (!a) continue;
    const arr = a.array as Float32Array;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) arr[i] = key === 'color' ? 1 : 0;
  }
}

/** True when `g` already has exactly the canonical layout (can be shared
 * with the live scene as-is). */
export function isNormalized(g: THREE.BufferGeometry, withColor = true): boolean {
  const keys = Object.keys(g.attributes).sort();
  const want = withColor ? ['color', 'normal', 'position', 'uv'] : ['normal', 'position', 'uv'];
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) return false;
  const size: Record<string, number> = { position: 3, normal: 3, uv: 2, color: 4 };
  for (const k of keys) {
    const a = g.attributes[k] as Attr;
    if (!isFastFloat(a) || a.itemSize !== size[k]) return false;
  }
  if (Object.keys(g.morphAttributes).length) return false;
  const dr = g.drawRange;
  return !!g.index && g.index.array instanceof Uint32Array && g.groups.length === 0 && dr.start === 0 && dr.count === Infinity;
}

/** "key:itemSize:Type,…|index:Type" — equal strings merge in the path tracer. */
export function attributeSignature(g: THREE.BufferGeometry): string {
  const parts = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const a = g.attributes[k] as Attr;
      return `${k}:${a.itemSize}:${a.array.constructor.name}${a.normalized ? ':n' : ''}`;
    });
  return `${parts.join(',')}|index:${g.index ? g.index.array.constructor.name : 'none'}`;
}

/** Bake many placements of one canonical geometry into a single geometry
 * (InstancedMesh expansion). `colors` multiplies the vertex color per
 * placement (instanceColor). */
export function mergeTransformed(
  base: THREE.BufferGeometry,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[] | null,
): THREE.BufferGeometry {
  const P = base.getAttribute('position').array as Float32Array;
  const N = base.getAttribute('normal').array as Float32Array;
  const U = base.getAttribute('uv').array as Float32Array;
  const Ca = base.getAttribute('color');
  const C = Ca ? (Ca.array as Float32Array) : null;
  const I = base.index!.array as Uint32Array;
  const vc = P.length / 3;
  const n = matrices.length;
  const P2 = new Float32Array(vc * 3 * n);
  const N2 = new Float32Array(vc * 3 * n);
  const U2 = new Float32Array(vc * 2 * n);
  const C2 = C || colors ? new Float32Array(vc * 4 * n) : null;
  const I2 = new Uint32Array(I.length * n);
  const nm = new THREE.Matrix3();
  for (let k = 0; k < n; k++) {
    const e = matrices[k].elements;
    const q = nm.getNormalMatrix(matrices[k]).elements;
    const flip = matrices[k].determinant() < 0;
    const vo = k * vc;
    for (let v = 0; v < vc; v++) {
      const x = P[v * 3];
      const y = P[v * 3 + 1];
      const z = P[v * 3 + 2];
      const o = (vo + v) * 3;
      P2[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P2[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P2[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N[v * 3];
      const b = N[v * 3 + 1];
      const c = N[v * 3 + 2];
      let nx = q[0] * a + q[3] * b + q[6] * c;
      let ny = q[1] * a + q[4] * b + q[7] * c;
      let nz = q[2] * a + q[5] * b + q[8] * c;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      N2[o] = nx;
      N2[o + 1] = ny;
      N2[o + 2] = nz;
      U2[(vo + v) * 2] = U[v * 2];
      U2[(vo + v) * 2 + 1] = U[v * 2 + 1];
      if (C2) {
        const tint = colors?.[k];
        for (let ch = 0; ch < 4; ch++) {
          const baseC = C ? C[v * 4 + ch] : 1;
          const t = tint && ch < 3 ? (ch === 0 ? tint.r : ch === 1 ? tint.g : tint.b) : 1;
          C2[(vo + v) * 4 + ch] = baseC * t;
        }
      }
    }
    const io = k * I.length;
    for (let t = 0; t < I.length; t += 3) {
      I2[io + t] = I[t] + vo;
      I2[io + t + 1] = (flip ? I[t + 2] : I[t + 1]) + vo;
      I2[io + t + 2] = (flip ? I[t + 1] : I[t + 2]) + vo;
    }
  }
  return assemble(P2, N2, U2, C2, I2);
}

/** Split descriptor for a mesh: one entry per drawable (group, material). */
export function drawParts(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): { material: THREE.Material; range?: { start: number; count: number } }[] {
  if (!Array.isArray(material)) return [{ material }];
  if (!geometry.groups.length) return material[0] ? [{ material: material[0] }] : [];
  const parts: { material: THREE.Material; range: { start: number; count: number } }[] = [];
  for (const g of geometry.groups) {
    const m = material[g.materialIndex ?? 0];
    if (m && g.count > 0) parts.push({ material: m, range: { start: g.start, count: g.count } });
  }
  return parts;
}
