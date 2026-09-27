import * as THREE from 'three';
import { IN } from '../constants';
import { tag } from '../render/tags';
import { BARK_TILE_IN, barkTextures, leafAtlasTexture, type BarkKind, type LeafKind } from './texturesExterior';

// ---------------------------------------------------------------------------
// Tree generator. A tree = hand-authored (or auto-generated) scaffold limbs
// → procedural side branching (seeded, crown-envelope steered) → pipe-model
// radii (r² = Σ r_child²) → tubes on parallel-transport frames (taper, root
// flare, bark ridging) + alpha-cut leaf-cluster cards on the finest twigs.
// Everything is authored in inches (model frame, y up) and emitted in meters.
//
// Output is split by level of detail: `bark` (trunks → fine branches, both
// LODs), `barkRender` (twigs, render only), `leavesLive` (fewer, larger
// cards for the editing view) and `leavesRender` (dense cards for the path
// tracer / Blender). Callers tag render-only meshes with
// userData.render = { lod: 'render' } and live-only ones with lod 'live'.
// ---------------------------------------------------------------------------

export type V3 = [number, number, number];

export interface FootprintIn {
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** like an item yaw: positive turns local +x toward −z */
  rotDeg: number;
}

export interface LimbSpec {
  /** control points, inches */
  pts: V3[];
  /** radius at each control point, inches */
  r: number[];
  /** arc fraction from which side branches may sprout (default 0.2; ≥1 none) */
  sprout?: number;
  /** trunk through a deck: rings turn horizontal at the base and take the
   * footprint ellipse shape (inset by `clearance`) at y = deckY */
  flare?: { footprint: FootprintIn; deckY: number; height: number; clearance: number };
  /** ring resolution override */
  radial?: number;
}

export interface CrownLobe {
  c: V3;
  r: V3;
}

export interface TreeSpec {
  limbs: LimbSpec[];
  crown: CrownLobe[];
  /** lowest height branches/leaves may reach at (x, z), inches */
  floorY?: (x: number, z: number) => number;
  /** multiplies side-branch counts (fewer branches for far trees) */
  density?: number;
  /** multiplies level-1 branch lengths (a wider crown off the same scaffold) */
  reach?: number;
}

export interface LevelParams {
  /** inches between side branches along the parent */
  spacing: number;
  /** branch length range, inches */
  len: [number, number];
  /** branching angle off the parent, degrees */
  angle: [number, number];
  /** upward bend per unit length (phototropism) */
  up: number;
  /** downward bend toward the tip (gravity on long limbs) */
  droop: number;
  /** random direction change per segment */
  wander: number;
  /** segment length, inches */
  segLen: number;
  /** tube sides (0 = no geometry) */
  radial: number;
  /** geometry only in the render LOD */
  renderOnly?: boolean;
}

export interface Species {
  name: string;
  bark: BarkKind;
  leaf: LeafKind;
  /** procedural levels below the scaffold; the last one carries leaves */
  levels: LevelParams[];
  /** radius of a leaf-bearing twig tip, inches */
  tipRadius: number;
  /** extra radius per inch toward the base (keeps pipe-model twigs tapered) */
  taper: number;
  cards: {
    live: number;
    render: number;
    sizeLive: number;
    sizeRender: number;
    /** how far cards scatter around the twig, inches */
    spread: number;
    /** 0 = normals follow the card, 1 = normals point out of the crown */
    crownNormals: number;
    /** pendulous leaves (eucalyptus): cards hang instead of facing out */
    hang?: number;
  };
  /** leaf tint multipliers (linear-ish), picked per card */
  tints: V3[];
  /** bark ridge amplitude (fraction of radius) */
  ridge: number;
  /** bias for side branches to grow away from the trunk axis */
  outward: number;
  /** scaffold tube resolution: resample step (inches) and max ring sides */
  scaffoldStep?: number;
  scaffoldMaxRadial?: number;
}

// ---------------------------------------------------------------------------
// Species presets (shared by the deck oak and the surroundings)
// ---------------------------------------------------------------------------

export const COAST_LIVE_OAK: Species = {
  name: 'coastLiveOak',
  bark: 'oak',
  leaf: 'oak',
  levels: [
    { spacing: 30, len: [80, 150], angle: [35, 62], up: 0.02, droop: 0.2, wander: 0.2, segLen: 14, radial: 7 },
    { spacing: 15, len: [30, 62], angle: [30, 58], up: 0.06, droop: 0.1, wander: 0.22, segLen: 10, radial: 4 },
    { spacing: 7.6, len: [11, 22], angle: [30, 55], up: 0.12, droop: 0.02, wander: 0.25, segLen: 6, radial: 3, renderOnly: true },
  ],
  tipRadius: 0.22,
  taper: 0.004,
  cards: { live: 2, render: 12, sizeLive: 40, sizeRender: 19, spread: 8, crownNormals: 0.6 },
  tints: [
    [0.92, 0.95, 0.9],
    [1.0, 1.0, 1.0],
    [0.82, 0.86, 0.8],
    [1.08, 1.06, 0.96],
    [0.9, 0.98, 0.92],
  ],
  ridge: 0.05,
  outward: 0.35,
};

export const STONE_PINE: Species = {
  name: 'stonePine',
  bark: 'pine',
  leaf: 'pine',
  levels: [
    { spacing: 34, len: [60, 110], angle: [30, 55], up: 0.15, droop: 0.02, wander: 0.18, segLen: 14, radial: 6 },
    { spacing: 14, len: [20, 40], angle: [25, 50], up: 0.45, droop: 0, wander: 0.2, segLen: 10, radial: 4, renderOnly: true },
  ],
  tipRadius: 0.35,
  taper: 0.004,
  cards: { live: 2, render: 8, sizeLive: 34, sizeRender: 20, spread: 8, crownNormals: 0.75 },
  tints: [
    [1, 1, 1],
    [0.9, 0.95, 0.9],
    [1.05, 1.05, 0.95],
  ],
  ridge: 0.06,
  outward: 0.5,
  scaffoldStep: 16,
  scaffoldMaxRadial: 12,
};

export const EUCALYPTUS: Species = {
  name: 'eucalyptus',
  bark: 'eucalyptus',
  leaf: 'eucalyptus',
  levels: [
    { spacing: 40, len: [70, 140], angle: [25, 45], up: 0.2, droop: 0.1, wander: 0.2, segLen: 16, radial: 6 },
    { spacing: 20, len: [26, 48], angle: [30, 60], up: 0.05, droop: 0.2, wander: 0.25, segLen: 10, radial: 4 },
  ],
  tipRadius: 0.25,
  taper: 0.003,
  cards: { live: 2, render: 7, sizeLive: 34, sizeRender: 22, spread: 8, crownNormals: 0.45, hang: 0.8 },
  tints: [
    [1, 1, 1],
    [0.92, 0.96, 0.98],
    [1.06, 1.04, 1.0],
  ],
  ridge: 0.015,
  outward: 0.3,
  scaffoldStep: 16,
  scaffoldMaxRadial: 12,
};

export const OLIVE: Species = {
  name: 'olive',
  bark: 'olive',
  leaf: 'olive',
  levels: [
    { spacing: 18, len: [36, 70], angle: [30, 55], up: 0.2, droop: 0.05, wander: 0.25, segLen: 10, radial: 5 },
    { spacing: 8, len: [12, 22], angle: [30, 55], up: 0.3, droop: 0.05, wander: 0.25, segLen: 6, radial: 3, renderOnly: true },
  ],
  tipRadius: 0.2,
  taper: 0.004,
  cards: { live: 2, render: 8, sizeLive: 24, sizeRender: 13, spread: 6, crownNormals: 0.65 },
  tints: [
    [1, 1, 1],
    [0.94, 0.96, 0.94],
    [1.06, 1.06, 1.04],
  ],
  ridge: 0.06,
  outward: 0.4,
};

export const CRAPE_MYRTLE: Species = {
  name: 'crapeMyrtle',
  bark: 'crape',
  leaf: 'crape',
  levels: [
    { spacing: 14, len: [24, 44], angle: [20, 40], up: 0.35, droop: 0, wander: 0.2, segLen: 8, radial: 4 },
    { spacing: 7, len: [9, 16], angle: [25, 45], up: 0.4, droop: 0, wander: 0.25, segLen: 5, radial: 3, renderOnly: true },
  ],
  tipRadius: 0.18,
  taper: 0.004,
  cards: { live: 2, render: 6, sizeLive: 20, sizeRender: 12, spread: 5, crownNormals: 0.6 },
  tints: [
    [1, 1, 1],
    [0.92, 0.96, 0.9],
  ],
  ridge: 0.01,
  outward: 0.3,
};

/** Cheap far-field variant: one procedural level, big cards, coarse tubes. */
export function farVariant(sp: Species): Species {
  const l0 = sp.levels[0];
  return {
    ...sp,
    name: sp.name + 'Far',
    levels: [{ ...l0, spacing: l0.spacing * 1.6, radial: Math.min(4, l0.radial), segLen: l0.segLen * 2 }],
    tipRadius: sp.tipRadius * 4,
    scaffoldStep: 40,
    scaffoldMaxRadial: 6,
    cards: { ...sp.cards, live: 7, render: 12, sizeLive: sp.cards.sizeLive * 2.2, sizeRender: sp.cards.sizeLive * 1.6, spread: sp.cards.spread * 3.5 },
  };
}

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry accumulator (positions in meters)
// ---------------------------------------------------------------------------

class GeoBuf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangles(): number {
    return this.idx.length / 3;
  }
  toGeometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Branch structure
// ---------------------------------------------------------------------------

interface Branch {
  pts: THREE.Vector3[]; // inches
  rad: number[]; // inches
  level: number; // 0 = scaffold
  kids: { i: number; b: Branch }[];
  radial: number;
  renderOnly: boolean;
  flare?: LimbSpec['flare'];
  /** arc fraction where side branches may start */
  sprout: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function crownValue(p: THREE.Vector3, crown: CrownLobe[]): { v: number; lobe: CrownLobe } {
  let best = Infinity;
  let lobe = crown[0];
  for (const l of crown) {
    const dx = (p.x - l.c[0]) / l.r[0];
    const dy = (p.y - l.c[1]) / l.r[1];
    const dz = (p.z - l.c[2]) / l.r[2];
    const v = dx * dx + dy * dy + dz * dz;
    if (v < best) {
      best = v;
      lobe = l;
    }
  }
  return { v: Math.sqrt(best), lobe };
}

function randomUnit(rnd: () => number, out: THREE.Vector3): THREE.Vector3 {
  const u = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

function perpendicular(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.crossVectors(d, Math.abs(d.y) < 0.9 ? UP : _w.set(1, 0, 0));
  return out.normalize();
}

/** Resample authored control points into an evenly spaced smooth polyline. */
function resampleLimb(spec: LimbSpec, step: number): { pts: THREE.Vector3[]; rad: number[] } {
  const cps = spec.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (cps.length === 2) cps.splice(1, 0, cps[0].clone().lerp(cps[1], 0.5));
  const curve = new THREE.CatmullRomCurve3(cps, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  const pts = curve.getSpacedPoints(n);
  // radii: piecewise-linear in the control-point parameter (by arc length)
  const cum = [0];
  for (let i = 1; i < cps.length; i++) cum.push(cum[i - 1] + cps[i].distanceTo(cps[i - 1]));
  const tot = cum[cum.length - 1] || 1;
  const rad = pts.map((_, k) => {
    const s = (k / n) * tot;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const f = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
    return spec.r[i] + (spec.r[Math.min(i + 1, spec.r.length - 1)] - spec.r[i]) * Math.min(1, Math.max(0, f));
  });
  return { pts, rad };
}

interface GrowCtx {
  sp: Species;
  spec: TreeSpec;
  rnd: () => number;
  axis: THREE.Vector3; // trunk-cluster centre (inches), for "outward"
  twigs: Branch[];
}

function growBranch(p0: THREE.Vector3, d0: THREE.Vector3, len: number, level: number, ctx: GrowCtx): Branch | null {
  const L = ctx.sp.levels[level - 1];
  const nSeg = Math.max(2, Math.round(len / L.segLen));
  const ds = len / nSeg;
  const pts = [p0.clone()];
  const d = d0.clone();
  let p = p0.clone();
  for (let k = 1; k <= nSeg; k++) {
    const t = k / nSeg;
    d.addScaledVector(randomUnit(ctx.rnd, _v), L.wander);
    d.y += L.up * 0.35 - L.droop * t;
    const floor = ctx.spec.floorY ? ctx.spec.floorY(p.x, p.z) : -Infinity;
    if (p.y < floor + 6) d.y += 0.6;
    d.normalize();
    const next = p.clone().addScaledVector(d, ds);
    const { v, lobe } = crownValue(next, ctx.spec.crown);
    if (v > 1.12) {
      if (k <= 1) return null;
      break;
    }
    if (v > 0.95) {
      // steer back toward the lobe centre near the envelope
      _w.set(lobe.c[0] - next.x, lobe.c[1] - next.y, lobe.c[2] - next.z).normalize();
      d.lerp(_w, 0.35).normalize();
    }
    p = next;
    pts.push(p);
  }
  if (pts.length < 2) return null;
  const br: Branch = {
    pts,
    rad: [],
    level,
    kids: [],
    radial: L.radial,
    renderOnly: !!L.renderOnly,
    sprout: 0.12,
  };
  if (level < ctx.sp.levels.length) growKids(br, ctx);
  else ctx.twigs.push(br);
  return br;
}

function growKids(parent: Branch, ctx: GrowCtx): void {
  const lvl = parent.level + 1;
  const L = ctx.sp.levels[lvl - 1];
  if (!L) return;
  const pts = parent.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  if (total < 1) return;
  const rnd = ctx.rnd;
  const density = ctx.spec.density ?? 1;
  const spacing = L.spacing / density;
  let s = parent.sprout * total + spacing * (0.3 + rnd() * 0.7);
  let phi = rnd() * Math.PI * 2;
  const dir = new THREE.Vector3();
  const perpA = new THREE.Vector3();
  const perpB = new THREE.Vector3();
  const out = new THREE.Vector3();
  const place = (sAt: number, forward: boolean) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < sAt) i++;
    const f = Math.min(1, Math.max(0, (sAt - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i])));
    const p = pts[i].clone().lerp(pts[i + 1], f);
    const tan = _v.subVectors(pts[i + 1], pts[i]).normalize().clone();
    const ang = THREE.MathUtils.degToRad(forward ? 8 + rnd() * 12 : L.angle[0] + rnd() * (L.angle[1] - L.angle[0]));
    phi += 2.39996 + (rnd() - 0.5) * 0.8;
    perpendicular(tan, perpA);
    perpB.crossVectors(tan, perpA);
    dir
      .copy(tan)
      .multiplyScalar(Math.cos(ang))
      .addScaledVector(perpA, Math.sin(ang) * Math.cos(phi))
      .addScaledVector(perpB, Math.sin(ang) * Math.sin(phi));
    out.set(p.x - ctx.axis.x, 0, p.z - ctx.axis.z);
    if (out.lengthSq() > 1) dir.addScaledVector(out.normalize(), ctx.sp.outward);
    dir.y += L.up * 0.5;
    dir.normalize();
    const rel = sAt / total;
    const reach = lvl === 1 ? (ctx.spec.reach ?? 1) : 1;
    const len = (L.len[0] + rnd() * (L.len[1] - L.len[0])) * (forward ? 0.9 : 1 - 0.45 * rel) * reach;
    const b = growBranch(p, dir, len, lvl, ctx);
    if (b) parent.kids.push({ i: Math.min(i + (f > 0.5 ? 1 : 0), pts.length - 1), b });
  };
  while (s < total - spacing * 0.35) {
    place(s, false);
    s += spacing * (0.6 + rnd() * 0.8);
  }
  // leader continuation beyond the tip keeps limbs from ending bluntly
  if (parent.level === 0 || rnd() < 0.85) place(total * 0.985, true);
}

/** Pipe model: parent r² = own tip² + Σ child r² (accumulated tip → base). */
function pipeRadii(b: Branch, sp: Species): number {
  for (const k of b.kids) pipeRadii(k.b, sp);
  if (b.level === 0) {
    // authored scaffold keeps its radii; keep children visibly thinner
    for (const k of b.kids) {
      const lim = 0.72 * b.rad[k.i];
      if (k.b.rad[0] > lim) scaleRadii(k.b, lim / k.b.rad[0]);
    }
    return b.rad[0];
  }
  const n = b.pts.length;
  const add = new Float64Array(n);
  for (const k of b.kids) add[k.i] += k.b.rad[0] * k.b.rad[0];
  let r2 = sp.tipRadius * sp.tipRadius;
  let s = 0;
  b.rad = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    r2 += add[i];
    if (i < n - 1) s += b.pts[i].distanceTo(b.pts[i + 1]);
    b.rad[i] = Math.sqrt(r2) + sp.taper * s;
  }
  return b.rad[0];
}

function scaleRadii(b: Branch, k: number): void {
  for (let i = 0; i < b.rad.length; i++) b.rad[i] *= k;
  for (const c of b.kids) scaleRadii(c.b, k);
}

// ---------------------------------------------------------------------------
// Tubes on parallel-transport frames
// ---------------------------------------------------------------------------

function ellipseRadius(fp: FootprintIn, dirX: number, dirZ: number): number {
  // ellipse local axes: +x' = rot(1,0), +z' = rot(0,1) (item-yaw convention)
  const a = THREE.MathUtils.degToRad(fp.rotDeg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lx = dirX * c - dirZ * s;
  const lz = dirX * s + dirZ * c;
  return 1 / Math.sqrt((lx / fp.rx) ** 2 + (lz / fp.rz) ** 2);
}

function emitTube(b: Branch, sp: Species, out: GeoBuf, rnd: () => number): void {
  const pts = b.pts;
  const n = pts.length;
  const radial = b.radial;
  if (radial < 3 || n < 2) return;
  const T: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(c, a).normalize());
  }
  // initial normal: the lean direction for flared trunks (θ=0 faces the lean)
  const N = new THREE.Vector3();
  if (b.flare) {
    N.set(T[0].x, 0, T[0].z);
    if (N.lengthSq() < 1e-4) N.set(1, 0, 0);
    N.normalize();
    N.addScaledVector(T[0], -N.dot(T[0])).normalize();
  } else perpendicular(T[0], N);
  const B = new THREE.Vector3();
  const [tileU, tileV] = BARK_TILE_IN[sp.bark];
  const uRep = Math.max(1, Math.round((2 * Math.PI * b.rad[0]) / tileU));
  const base = out.vertexCount;
  const ridgeAmp = b.level === 0 ? sp.ridge : sp.ridge * 0.4;
  const ridgePhase = rnd() * 10;
  const ridgeN = 5 + ((rnd() * 5) | 0);
  const lobePhase = rnd() * Math.PI * 2;
  const hue = 0.94 + rnd() * 0.1;
  let s = 0;
  const dir = new THREE.Vector3();
  const hdir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      s += pts[i].distanceTo(pts[i - 1]);
      const axis = _v.crossVectors(T[i - 1], T[i]);
      const al = axis.length();
      if (al > 1e-6) {
        const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
        N.applyAxisAngle(axis.multiplyScalar(1 / al), ang);
      }
      N.addScaledVector(T[i], -N.dot(T[i])).normalize();
    }
    B.crossVectors(T[i], N);
    const p = pts[i];
    const r = b.rad[i];
    // flare: blend the ring toward a horizontal ellipse near and below the deck
    let wFlare = 0;
    let below = 0;
    if (b.flare) {
      const f = b.flare;
      // concave root flare: the ring swings from the horizontal footprint to
      // the tube over `height`, fastest near the deck (no collar)
      wFlare = Math.pow(1 - THREE.MathUtils.smoothstep(p.y, f.deckY + 1, f.deckY + f.height), 1.8);
      below = Math.max(0, f.deckY - p.y);
    }
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
      const ridge = 1 + ridgeAmp * (0.6 * Math.sin(ridgeN * th + s * 0.02 + ridgePhase + 1.3 * Math.sin(s * 0.011 + th)) + 0.4 * Math.sin(2.3 * ridgeN * th - s * 0.031));
      let px = p.x + dir.x * r * ridge;
      let py = p.y + dir.y * r * ridge;
      let pz = p.z + dir.z * r * ridge;
      let nx = dir.x;
      let ny = dir.y;
      let nz = dir.z;
      if (wFlare > 0 && b.flare) {
        const f = b.flare;
        hdir.set(dir.x, 0, dir.z);
        if (hdir.lengthSq() < 1e-6) hdir.set(N.x, 0, N.z);
        hdir.normalize();
        const re = ellipseRadius(f.footprint, hdir.x, hdir.z) - f.clearance;
        // buttress lobes: bulge below the deck; above it only the valleys
        // sink, so the flare never crosses the scribed opening
        const lobeWave = Math.max(0, Math.sin(4 * th + lobePhase));
        const lobes = below > 0 ? 1 + 0.12 * Math.min(1, below / 10) * lobeWave : 1 - 0.07 * (1 - lobeWave);
        const grow = 1 + 0.35 * THREE.MathUtils.smoothstep(below, 0, 40);
        const rr = re * grow * lobes * (1 + ridgeAmp * 0.5 * Math.sin(ridgeN * th + ridgePhase));
        const hx = p.x + hdir.x * rr;
        const hz = p.z + hdir.z * rr;
        px += (hx - px) * wFlare;
        py += (p.y - py) * wFlare;
        pz += (hz - pz) * wFlare;
        nx += (hdir.x - nx) * wFlare;
        ny *= 1 - wFlare;
        nz += (hdir.z - nz) * wFlare;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      out.pos.push(px * IN, py * IN, pz * IN);
      out.nor.push(nx, ny, nz);
      out.uv.push((j / radial) * uRep, s / tileV);
      // lichen/moss favours the tops of limbs; bases darker
      const topness = Math.max(0, ny) * (b.level === 0 ? 0.12 : 0.06);
      const ground = b.flare ? 0.8 + 0.2 * THREE.MathUtils.smoothstep(p.y, b.flare.deckY - 30, b.flare.deckY + 40) : 1;
      out.col.push((hue + topness) * ground, (hue + topness * 1.1) * ground, (hue + topness * 0.8) * ground);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * row + j;
      const bb = a + 1;
      const c = a + row + 1;
      const d = a + row;
      out.idx.push(a, bb, c, a, c, d);
    }
  }
}

// ---------------------------------------------------------------------------
// Leaf cards
// ---------------------------------------------------------------------------

function emitCards(
  twig: Branch,
  sp: Species,
  spec: TreeSpec,
  out: GeoBuf,
  count: number,
  size: number,
  rnd: () => number,
): void {
  const pts = twig.pts;
  const n = pts.length;
  const cN = new THREE.Vector3();
  const upH = new THREE.Vector3();
  const t = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const c = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const sn = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    // along the outer 70% of the twig, bunched toward the tip
    const u = 0.3 + 0.7 * Math.sqrt(rnd());
    const fi = u * (n - 1);
    const i = Math.min(n - 2, Math.floor(fi));
    c.copy(pts[i]).lerp(pts[i + 1], fi - i);
    c.addScaledVector(randomUnit(rnd, _v), sp.cards.spread * rnd());
    const { v, lobe } = crownValue(c, spec.crown);
    outward.set(c.x - lobe.c[0], (c.y - lobe.c[1]) * 1.4 + lobe.r[1] * 0.25, c.z - lobe.c[2]).normalize();
    const tw = _w.subVectors(pts[i + 1], pts[i]).normalize();
    const hang = sp.cards.hang ?? 0;
    // card faces out of the crown, jittered; its "up" follows the twig
    cN.copy(outward).multiplyScalar(0.7).addScaledVector(randomUnit(rnd, _v), 0.75);
    if (hang > 0) cN.y *= 1 - hang;
    cN.normalize();
    upH.copy(tw).lerp(outward, 0.3);
    if (hang > 0) upH.lerp(_v.set(0, -1, 0), hang); // hanging clusters
    t.crossVectors(upH, cN);
    if (t.lengthSq() < 1e-6) perpendicular(cN, t);
    t.normalize();
    bt.crossVectors(cN, t).normalize();
    const w = size * (0.8 + rnd() * 0.4);
    const h = w * (0.85 + rnd() * 0.25);
    // the card's base sits at the twig; it extends along bt
    const cx = c.x - bt.x * h * 0.3;
    const cy = c.y - bt.y * h * 0.3;
    const cz = c.z - bt.z * h * 0.3;
    sn.copy(cN).multiplyScalar(1 - sp.cards.crownNormals).addScaledVector(outward, sp.cards.crownNormals).normalize();
    const cell = (rnd() * 4) | 0;
    const u0 = (cell % 2) * 0.5;
    const v0 = cell < 2 ? 0.5 : 0; // canvas top row = high v
    const flip = rnd() < 0.5;
    const tint = sp.tints[(rnd() * sp.tints.length) | 0];
    // depth in the crown → darker (self-shadowed interior), undersides too
    const ao = (0.52 + 0.48 * THREE.MathUtils.smoothstep(v, 0.35, 1.0)) * (0.82 + 0.18 * Math.max(0, outward.y + 0.3));
    const base = out.vertexCount;
    const corners: [number, number][] = [
      [-0.5, 0],
      [0.5, 0],
      [0.5, 1],
      [-0.5, 1],
    ];
    for (const [a, bb] of corners) {
      out.pos.push((cx + t.x * a * w + bt.x * bb * h) * IN, (cy + t.y * a * w + bt.y * bb * h) * IN, (cz + t.z * a * w + bt.z * bb * h) * IN);
      out.nor.push(sn.x, sn.y, sn.z);
      const fu = flip ? 0.5 - a : a + 0.5;
      out.uv.push(u0 + fu * 0.49 + 0.005, v0 + bb * 0.49 + 0.005);
      out.col.push(tint[0] * ao, tint[1] * ao, tint[2] * ao);
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TreeStats {
  branches: number;
  twigs: number;
}

/** Accumulates any number of trees of one species into four geometries. */
export class TreeBatch {
  readonly bark = new GeoBuf();
  /** level ≥ 1 branches when `splitFine` (so a plan view can dissolve them) */
  readonly barkFine = new GeoBuf();
  readonly barkRender = new GeoBuf();
  readonly leavesLive = new GeoBuf();
  readonly leavesRender = new GeoBuf();
  stats: TreeStats = { branches: 0, twigs: 0 };

  constructor(
    readonly sp: Species,
    readonly splitFine = false,
  ) {}

  add(spec: TreeSpec, seed: number): void {
    const rnd = mulberry32(seed);
    const sp = this.sp;
    // scaffold
    const axis = new THREE.Vector3();
    const roots: Branch[] = spec.limbs.map((l) => {
      const step = l.flare ? 5 : (sp.scaffoldStep ?? Math.max(5, Math.min(12, l.r[0] * 0.9)));
      const { pts, rad } = resampleLimb(l, step);
      const maxR = sp.scaffoldMaxRadial ?? 22;
      return {
        pts,
        rad,
        level: 0,
        kids: [],
        radial: l.radial ?? Math.max(Math.min(8, maxR), Math.min(maxR, Math.round(l.r[0] * 1.1 + 4))),
        renderOnly: false,
        flare: l.flare,
        sprout: l.sprout ?? 0.2,
      };
    });
    for (const l of spec.limbs.filter((x) => x.flare)) axis.add(new THREE.Vector3(...l.pts[0]));
    const nTr = spec.limbs.filter((x) => x.flare).length;
    if (nTr) axis.multiplyScalar(1 / nTr);
    else axis.set(...spec.limbs[0].pts[0]);
    const ctx: GrowCtx = { sp, spec, rnd, axis, twigs: [] };
    for (const r of roots) if (r.sprout < 1) growKids(r, ctx);
    for (const r of roots) pipeRadii(r, sp);

    const visit = (b: Branch) => {
      this.stats.branches++;
      emitTube(b, sp, b.renderOnly ? this.barkRender : this.splitFine && b.level > 0 ? this.barkFine : this.bark, rnd);
      for (const k of b.kids) visit(k.b);
    };
    for (const r of roots) visit(r);
    // leaves: live and render sets are drawn independently from their own
    // streams so the live subset never depends on the render card count
    const rl = mulberry32(seed ^ 0x51f15e);
    const rr = mulberry32(seed ^ 0x7e11a);
    for (const tw of ctx.twigs) {
      emitCards(tw, sp, spec, this.leavesLive, sp.cards.live, sp.cards.sizeLive, rl);
      emitCards(tw, sp, spec, this.leavesRender, sp.cards.render, sp.cards.sizeRender, rr);
    }
    this.stats.twigs += ctx.twigs.length;
  }
}

// ---------------------------------------------------------------------------
// Auto scaffolds for surrounding trees (species habit)
// ---------------------------------------------------------------------------

export interface AutoTreeOpts {
  x: number;
  z: number;
  /** ground height at the base, inches */
  y: number;
  /** overall height, inches */
  height: number;
  /** crown radius, inches */
  spread: number;
  leanDeg?: number;
  leanAzDeg?: number;
  seed: number;
}

export function autoTree(sp: Species, o: AutoTreeOpts): TreeSpec {
  const rnd = mulberry32(o.seed * 7919 + 13);
  const lean = THREE.MathUtils.degToRad(o.leanDeg ?? 5 + rnd() * 10);
  const lAz = THREE.MathUtils.degToRad(o.leanAzDeg ?? rnd() * 360);
  const lx = Math.sin(lAz);
  const lz = -Math.cos(lAz);
  const H = o.height;
  const S = o.spread;
  const limbs: LimbSpec[] = [];
  const crown: CrownLobe[] = [];
  const P = (x: number, y: number, z: number): V3 => [x, y, z];
  const kind = sp.bark;

  if (kind === 'pine') {
    // tall bare trunk with a gentle sweep, umbrella of limbs on top
    const trunkH = H * 0.72;
    const r0 = 7 + H * 0.012;
    const pts: V3[] = [];
    const rs: number[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const off = Math.sin(t * Math.PI * 0.8) * trunkH * Math.tan(lean) * 0.6 + t * t * trunkH * Math.tan(lean) * 0.4;
      pts.push(P(o.x + lx * off + (rnd() - 0.5) * 6, o.y - 10 + t * (trunkH + 10), o.z + lz * off + (rnd() - 0.5) * 6));
      rs.push(r0 * (1 - 0.45 * t));
    }
    limbs.push({ pts, r: rs, sprout: 1 });
    const top = pts[pts.length - 1];
    const nL = 4 + ((rnd() * 3) | 0);
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * Math.PI * 2 + rnd() * 0.6;
      const reach = S * (0.45 + rnd() * 0.25);
      const rise = H * 0.16 + rnd() * H * 0.06;
      limbs.push({
        pts: [
          top,
          P(top[0] + Math.cos(a) * reach * 0.35, top[1] + rise * 0.6, top[2] + Math.sin(a) * reach * 0.35),
          P(top[0] + Math.cos(a) * reach * 0.75, top[1] + rise, top[2] + Math.sin(a) * reach * 0.75),
          P(top[0] + Math.cos(a) * reach, top[1] + rise * 1.05, top[2] + Math.sin(a) * reach),
        ],
        r: [r0 * 0.5, r0 * 0.36, r0 * 0.22, r0 * 0.12],
        sprout: 0.3,
      });
    }
    crown.push({ c: [top[0], top[1] + H * 0.2, top[2]], r: [S, H * 0.13, S] });
    return { limbs, crown, density: 1 };
  }

  if (kind === 'eucalyptus') {
    const r0 = 5 + H * 0.005;
    const forkH = H * (0.2 + rnd() * 0.08);
    const trunk: V3[] = [
      P(o.x, o.y - 10, o.z),
      P(o.x + lx * 6 + (rnd() - 0.5) * 10, o.y + forkH * 0.45, o.z + lz * 6 + (rnd() - 0.5) * 10),
      P(o.x + lx * 16, o.y + forkH, o.z + lz * 16),
    ];
    limbs.push({ pts: trunk, r: [r0, r0 * 0.9, r0 * 0.8], sprout: 1 });
    const f = trunk[2];
    const nL = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * Math.PI * 2 + rnd();
      const sp2 = S * (0.25 + rnd() * 0.2);
      const top = H - forkH;
      limbs.push({
        pts: [
          f,
          P(f[0] + Math.cos(a) * sp2 * 0.3, f[1] + top * 0.35, f[2] + Math.sin(a) * sp2 * 0.3),
          P(f[0] + Math.cos(a) * sp2 * 0.7 + (rnd() - 0.5) * 30, f[1] + top * 0.7, f[2] + Math.sin(a) * sp2 * 0.7 + (rnd() - 0.5) * 30),
          P(f[0] + Math.cos(a) * sp2, f[1] + top * 0.95, f[2] + Math.sin(a) * sp2),
        ],
        r: [r0 * 0.7, r0 * 0.55, r0 * 0.35, r0 * 0.15],
        sprout: 0.25,
      });
    }
    crown.push({ c: [f[0], o.y + H * 0.66, f[2]], r: [S, H * 0.36, S] });
    return { limbs, crown };
  }

  // broadleaf habit (oak, olive, crape): short trunk, spreading sinuous limbs
  const multi = kind === 'crape';
  const trunkH = multi ? 0 : H * (kind === 'olive' ? 0.18 : 0.14 + rnd() * 0.08);
  const r0 = multi ? 2.2 : kind === 'olive' ? 6 + H * 0.02 : 8 + H * 0.028;
  const base: V3 = P(o.x, o.y - 12, o.z);
  const fork: V3 = P(o.x + lx * trunkH * Math.tan(lean), o.y + trunkH, o.z + lz * trunkH * Math.tan(lean));
  if (!multi) limbs.push({ pts: [base, P((base[0] + fork[0]) / 2 + (rnd() - 0.5) * 6, (base[1] + fork[1]) / 2, (base[2] + fork[2]) / 2 + (rnd() - 0.5) * 6), fork], r: [r0 * 1.15, r0, r0 * 0.9], sprout: 1 });
  const nL = multi ? 4 + ((rnd() * 2) | 0) : 3 + ((rnd() * 3) | 0);
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2 + rnd() * 0.8;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = multi ? 0.18 + rnd() * 0.12 : 0.5 + rnd() * 0.35; // horizontal reach vs rise
    const reach = S * (multi ? 0.55 : 0.55 + rnd() * 0.3);
    const rise = (H - trunkH) * (multi ? 0.85 : 0.55 + rnd() * 0.25);
    const wob = () => (rnd() - 0.5) * reach * 0.18;
    const from = multi ? P(o.x + ca * 3, o.y - 6, o.z + sa * 3) : fork;
    const rr = multi ? r0 : r0 * (0.55 + rnd() * 0.15);
    limbs.push({
      pts: [
        from,
        P(from[0] + ca * reach * 0.25 * out * 2 + wob(), from[1] + rise * 0.3, from[2] + sa * reach * 0.25 * out * 2 + wob()),
        P(from[0] + ca * reach * 0.6 + wob(), from[1] + rise * (0.55 + (multi ? 0.1 : 0)), from[2] + sa * reach * 0.6 + wob()),
        P(from[0] + ca * reach * 0.9 + wob(), from[1] + rise * 0.85, from[2] + sa * reach * 0.9 + wob()),
      ],
      r: [rr, rr * 0.75, rr * 0.5, rr * 0.28],
      sprout: multi ? 0.35 : 0.25,
    });
  }
  const cy = o.y + trunkH + (H - trunkH) * 0.55;
  crown.push({ c: [fork[0], cy, fork[2]], r: [S, (H - trunkH) * 0.5, S] });
  return { limbs, crown, floorY: () => o.y + (multi ? 20 : trunkH * 0.6) };
}

// ---------------------------------------------------------------------------
// Materials (one set per species / batch)
// ---------------------------------------------------------------------------

const barkCache = new Map<BarkKind, ReturnType<typeof barkTextures>>();
const leafCache = new Map<LeafKind, THREE.DataTexture>();

export function barkMaterial(kind: BarkKind, id: string, opts: LeafMaterialOpts = {}): THREE.MeshStandardMaterial {
  let t = barkCache.get(kind);
  if (!t) {
    t = barkTextures(kind);
    barkCache.set(kind, t);
  }
  const m = tag(
    new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(1, 1),
      vertexColors: true,
      roughness: kind === 'eucalyptus' || kind === 'crape' ? 0.7 : 0.93,
      metalness: 0,
    }),
    'bark',
    {},
    id,
  );
  if (opts.planFade) rasterTweaks(m, opts.planFade.uniform, false);
  return m;
}

/** Raster-only shader tweaks (the path tracer / Blender map the role, not
 * this shader): keep alpha coverage through the mip chain so distant canopies
 * don't thin out, and optionally dissolve the mesh in the top-down plan view
 * (screen-space dither, so shadows keep their dapple). */
function rasterTweaks(m: THREE.Material, fade: { value: number } | undefined, alphaBoost: boolean): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPlanFade = fade ?? { value: 0 };
    shader.uniforms.uAtlasSize = { value: 1024 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPlanFade;
uniform float uAtlasSize;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
${
  alphaBoost
    ? `  vec2 duv = max(abs(dFdx(vMapUv)), abs(dFdy(vMapUv))) * uAtlasSize;
  diffuseColor.a *= 1.0 + max(0.0, log2(max(duv.x, duv.y))) * 0.28;`
    : ''
}
  if (uPlanFade > 0.0) {
    float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (h < uPlanFade) discard;
  }
}`,
      );
  };
  m.customProgramCacheKey = () => `wp-tree-${alphaBoost ? 'a' : 'o'}${fade ? 'f' : 'p'}`;
}

export interface LeafMaterialOpts {
  /** raster-only: fade the cards out when seen from high above (plan view) */
  planFade?: { uniform: { value: number } };
}

export function leafMaterial(kind: LeafKind, id: string, opts: LeafMaterialOpts = {}): THREE.MeshStandardMaterial {
  let tex = leafCache.get(kind);
  if (!tex) {
    tex = leafAtlasTexture(kind);
    leafCache.set(kind, tex);
  }
  const m = tag(
    new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: kind === 'oak' ? 0.72 : 0.82,
      metalness: 0,
    }),
    'foliage',
    { translucency: kind === 'pine' ? 0.2 : 0.35 },
    id,
  );
  rasterTweaks(m, opts.planFade?.uniform, true);
  return m;
}

/** Build meshes for a batch: shared bark, render-only twigs (hidden live),
 * live leaves (excluded from renders) and render leaves (hidden live). */
export function batchMeshes(
  batch: TreeBatch,
  mats: { bark: THREE.Material; leaves: THREE.Material; leavesRender?: THREE.Material; barkFine?: THREE.Material },
  shadows = true,
): THREE.Group {
  const g = new THREE.Group();
  g.name = `trees-${batch.sp.name}`;
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, lod: 'live' | 'render' | null, name: string) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = true;
    if (lod) {
      m.userData.render = { lod };
      if (lod === 'render') m.visible = false;
    }
    g.add(m);
  };
  add(batch.bark.toGeometry(), mats.bark, null, `${batch.sp.name}-bark`);
  add(batch.barkFine.toGeometry(), mats.barkFine ?? mats.bark, null, `${batch.sp.name}-branches`);
  add(batch.barkRender.toGeometry(), mats.bark, 'render', `${batch.sp.name}-twigs`);
  add(batch.leavesLive.toGeometry(), mats.leaves, 'live', `${batch.sp.name}-leaves-live`);
  add(batch.leavesRender.toGeometry(), mats.leavesRender ?? mats.leaves, 'render', `${batch.sp.name}-leaves-render`);
  return g;
}
