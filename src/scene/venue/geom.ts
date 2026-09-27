import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALL_EAVE_Y, RIDGE_X, RIDGE_Y, i2m } from '../../constants';

// Inch-space geometry helpers for the hall. Everything is authored in inches
// (model frame: +x east, +z south, y up) and emitted in meters.

export type Geo = THREE.BufferGeometry;

/** Hall roof pitch (≈2.9:12): wall-top line HALL_EAVE_Y at x=0/545, ridge RIDGE_Y. */
export const SLOPE = (RIDGE_Y - HALL_EAVE_Y) / RIDGE_X;
export const THETA = Math.atan(SLOPE);
/** Underside of the reed ceiling plane at plan x (valid past the walls too). */
export const roofY = (x: number): number => HALL_EAVE_Y + (RIDGE_X - Math.abs(x - RIDGE_X)) * SLOPE;

/** Exposed rafter depth below the reed plane, and the glulam under them. */
export const RAFTER_D = 8;
export const RAFTER_W = 3.5;
export const GLULAM_D = 15;
export const GLULAM_W = 6.75;

/** Axis-aligned box from inch bounds, emitted in meters. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const g = new THREE.BoxGeometry(i2m(x1 - x0), i2m(y1 - y0), i2m(z1 - z0));
  g.translate(i2m((x0 + x1) / 2), i2m((y0 + y1) / 2), i2m((z0 + z1) / 2));
  return g;
}

/**
 * Box laid parallel to a hall roof slope between plan x = xa..xb (one side of
 * the ridge). `offset` is the perpendicular gap from the roof underside line to
 * the box underside (negative hangs below the roof plane).
 */
export function slopedBox(xa: number, xb: number, thick: number, z0: number, z1: number, offset: number): Geo {
  const ya = roofY(xa);
  const yb = roofY(xb);
  const len = Math.hypot(xb - xa, yb - ya);
  const th = (xa + xb) / 2 > RIDGE_X ? -THETA : THETA;
  const g = new THREE.BoxGeometry(i2m(len), i2m(thick), i2m(z1 - z0));
  g.rotateZ(th);
  const d = offset + thick / 2;
  const nx = -Math.sin(th);
  const ny = Math.cos(th);
  g.translate(i2m((xa + xb) / 2 + nx * d), i2m((ya + yb) / 2 + ny * d), i2m((z0 + z1) / 2));
  return g;
}

/** Single-sided plane on a hall roof slope; faceUp=false faces the room.
 * UVs: u runs up/down the slope (plan x), v runs along z. */
export function slopedPlane(xa: number, xb: number, z0: number, z1: number, offset: number, faceUp: boolean): Geo {
  const ya = roofY(xa);
  const yb = roofY(xb);
  const len = Math.hypot(xb - xa, yb - ya);
  const th = (xa + xb) / 2 > RIDGE_X ? -THETA : THETA;
  const g = new THREE.PlaneGeometry(i2m(len), i2m(z1 - z0));
  g.rotateX(faceUp ? -Math.PI / 2 : Math.PI / 2);
  g.rotateZ(th);
  const nx = -Math.sin(th);
  const ny = Math.cos(th);
  g.translate(i2m((xa + xb) / 2 + nx * offset), i2m((ya + yb) / 2 + ny * offset), i2m((z0 + z1) / 2));
  return g;
}

/** Outline in the x/y plane from y = yBot up to the hall roof line minus
 * `drop`, between plan x0..x1 (kinks at the ridge when it spans it). */
function gableOutline(x0: number, x1: number, yBot: number, drop: number): THREE.Vector2[] {
  const pts = [new THREE.Vector2(i2m(x0), i2m(yBot)), new THREE.Vector2(i2m(x1), i2m(yBot))];
  pts.push(new THREE.Vector2(i2m(x1), i2m(roofY(x1) - drop)));
  if (x0 < RIDGE_X && x1 > RIDGE_X) pts.push(new THREE.Vector2(i2m(RIDGE_X), i2m(roofY(RIDGE_X) - drop)));
  pts.push(new THREE.Vector2(i2m(x0), i2m(roofY(x0) - drop)));
  return pts;
}

/** E-W wall slab (z0..z1 thick) whose top follows the hall roof line. */
export function gablePrism(x0: number, x1: number, z0: number, z1: number, yBot: number, drop = 0): Geo {
  const shape = new THREE.Shape(gableOutline(x0, x1, yBot, drop));
  const g = new THREE.ExtrudeGeometry(shape, { depth: i2m(z1 - z0), bevelEnabled: false, steps: 1 });
  g.translate(0, 0, i2m(z0));
  return g;
}

/** Flat pane in the plane z (e.g. clerestory glass), under the roof line. */
export function gablePane(x0: number, x1: number, z: number, yBot: number, drop = 0): Geo {
  const g = new THREE.ShapeGeometry(new THREE.Shape(gableOutline(x0, x1, yBot, drop)));
  g.translate(0, 0, i2m(z));
  return g;
}

/** Merge geometries into one mesh (normalizes indexed/non-indexed mixes). */
function mergeAll(geos: Geo[]): Geo {
  const anyNonIndexed = geos.some((g) => !g.index);
  const list = anyNonIndexed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
  for (const g of list) {
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
  }
  const out = mergeGeometries(list);
  if (!out) throw new Error('venue: mergeGeometries failed');
  return out;
}

export function merged(geos: Geo[], mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(mergeAll(geos), mat);
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Cylinder between two inch-space points. */
export function rod(a: P3, b: P3, r: number, seg = 8): Geo {
  const va = new THREE.Vector3(a.x, a.y, a.z);
  const vb = new THREE.Vector3(b.x, b.y, b.z);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(i2m(r), i2m(r), i2m(len), seg, 1);
  const dir = vb.clone().sub(va).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(i2m(mid.x), i2m(mid.y), i2m(mid.z));
  return g;
}

/** Box-projected UVs in inches / tileIn from world positions (per-face
 * dominant normal axis) so tiled textures keep a true scale on any box. */
export function worldUV(g: Geo, tileIn: number): Geo {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / i2m(tileIn);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i) * k;
    const y = pos.getY(i) * k;
    const z = pos.getZ(i) * k;
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (ax >= az) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Scale a plane's 0..1 UVs to (uIn, vIn) inches per tile repeat. */
export function scaleUV(g: Geo, uIn: number, vIn: number, tileIn: number): Geo {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * uIn) / tileIn, (uv.getY(i) * vIn) / tileIn);
  uv.needsUpdate = true;
  return g;
}

/** Triangle count of a mesh tree (visible or not). */
export function triCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
  });
  return n;
}
