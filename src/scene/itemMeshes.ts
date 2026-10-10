import * as THREE from 'three';
import { tag } from '../render/tags';
import {
  CHAIR_BACK_H,
  CHAIR_SEAT_H,
  COLORS,
  FIGURE_HEIGHTS,
  HEDGE_H,
  ITEM_DIMS,
  LANTERN_SPECS,
  SCREEN_H,
  LEG_SIZE,
  TABLE_TOPS,
  TABLE_TOP_T,
  PLANTER_SPECS,
  isLantern,
  isPlant,
  isPlanter,
  isTable,
  type LanternType,
  type PlantType,
  type PlanterType,
  type TableType,
  i2m,
} from '../constants';
import { DEG, unrot } from '../core/geometry';
import type { ItemType, PlacedItem } from '../types';
import { dioriteTextures, oakTableTextures, teakTableTextures } from './textures';

const woodMaterials = new Map<string, THREE.MeshStandardMaterial>();

function tableMaterial(type: TableType | 'chair'): THREE.MeshStandardMaterial {
  const key = type === 'tableQ' ? 'teak' : 'oak';
  let mat = woodMaterials.get(key);
  if (!mat) {
    const tex = key === 'teak' ? teakTableTextures() : oakTableTextures();
    mat = tag(new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bumpMap,
      bumpScale: 0.015,
      roughness: key === 'teak' ? 0.45 : 0.5,
      metalness: 0,
    }), 'wood-table', {}, key);
    woodMaterials.set(key, mat);
  }
  return mat;
}

const templates = new Map<ItemType, THREE.Group>();
const tableOutlines = new Map<TableType, THREE.BufferGeometry>();

function buildTableTemplate(type: TableType, dimsOverride?: { w: number; d: number; h?: number }): THREE.Group {
  if (type === 'tableCoffee') return buildCoffeeTable();
  const { w, d } = dimsOverride ?? ITEM_DIMS[type];
  const top = dimsOverride?.h ?? TABLE_TOPS[type];
  const wood = tableMaterial(type);
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(TABLE_TOP_T), i2m(d)), wood);
  slab.position.y = i2m(top - TABLE_TOP_T / 2);
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  const legGeom = new THREE.BoxGeometry(i2m(LEG_SIZE), i2m(top - TABLE_TOP_T), i2m(LEG_SIZE));
  const inset = LEG_SIZE / 2;
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const leg = new THREE.Mesh(legGeom, wood);
    leg.position.set(
      i2m(sx * (w / 2 - inset)),
      i2m((top - TABLE_TOP_T) / 2),
      i2m(sz * (d / 2 - inset)),
    );
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

/** Small charcoal powder-coat table from the couple's photos: a square top
 * with a border frame round inset slats, a flush apron, and square legs flush
 * with the corners (parsons style). Four push together into one low table. */
function buildCoffeeTable(): THREE.Group {
  const { w, d } = ITEM_DIMS.tableCoffee;
  const top = TABLE_TOPS.tableCoffee;
  const mat = tag(new THREE.MeshStandardMaterial({ color: 0x3e4144, roughness: 0.68, metalness: 0.15 }), 'generic', {}, 'coffeeCharcoal');
  const g = new THREE.Group();
  const add = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(i2m(bw), i2m(bh), i2m(bd)), mat);
    m.position.set(i2m(x), i2m(y), i2m(z));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const t = 0.9; // top thickness
  const rim = Math.min(1.4, w * 0.12); // border frame width
  // border frame
  add(w, t, rim, 0, top - t / 2, d / 2 - rim / 2);
  add(w, t, rim, 0, top - t / 2, -(d / 2 - rim / 2));
  add(rim, t, d - 2 * rim, w / 2 - rim / 2, top - t / 2, 0);
  add(rim, t, d - 2 * rim, -(w / 2 - rim / 2), top - t / 2, 0);
  // inset slats running along x, a hair below the frame, 1/4" gaps
  const n = w >= 20 ? 4 : 3;
  const gap = 0.25;
  const inner = d - 2 * rim;
  const slatW = (inner - gap * (n + 1)) / n;
  for (let k = 0; k < n; k++) add(w - 2 * rim, t * 0.8, slatW, 0, top - t / 2 - 0.1, -inner / 2 + gap + slatW / 2 + k * (slatW + gap));
  // flush apron under the frame
  const apH = Math.min(2, top * 0.16);
  const apT = 0.6;
  const ay = top - t - apH / 2;
  add(w, apH, apT, 0, ay, d / 2 - apT / 2);
  add(w, apH, apT, 0, ay, -(d / 2 - apT / 2));
  add(apT, apH, d - 2 * apT, w / 2 - apT / 2, ay, 0);
  add(apT, apH, d - 2 * apT, -(w / 2 - apT / 2), ay, 0);
  // square legs flush with the corners
  const legS = Math.min(2.25, w * 0.15);
  const legH = top - t;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(legS, legH, legS, sx * (w / 2 - legS / 2), legH / 2, sz * (d / 2 - legS / 2));
  return g;
}

/** Teak deep-seating lounge piece from the couple's photos: weathered-gray
 * teak base and wide flat arms, a slatted back, linen seat and back cushions
 * and throw pillows. One seat per ~26". Faces +z at yaw 0, like the chair. */
function buildLounge(type: 'loungeSofa' | 'loungeChair'): THREE.Group {
  const { w, d } = ITEM_DIMS[type];
  const seats = type === 'loungeSofa' ? 3 : 1;
  const teak = tag(new THREE.MeshStandardMaterial({ color: 0x8b847a, roughness: 0.82, metalness: 0 }), 'generic', {}, 'loungeTeak');
  const linen = tag(new THREE.MeshStandardMaterial({ color: 0xd3cbbd, roughness: 0.92, metalness: 0 }), 'fabric', {}, 'loungeLinen');
  const pillowMat = tag(new THREE.MeshStandardMaterial({ color: 0xe4dfd5, roughness: 0.9, metalness: 0 }), 'fabric', {}, 'loungePillow');
  const g = new THREE.Group();
  const box = (mat: THREE.Material, bw: number, bh: number, bd: number, x: number, y: number, z: number, tiltX = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(i2m(bw), i2m(bh), i2m(bd)), mat);
    m.position.set(i2m(x), i2m(y), i2m(z));
    m.rotation.x = tiltX;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const armW = 5;
  const baseTop = 11;
  // base with notched feet at the corners
  box(teak, w, baseTop - 2, d, 0, 2 + (baseTop - 2) / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(teak, 5, 2, 5, sx * (w / 2 - 2.5), 1, sz * (d / 2 - 2.5));
  // wide flat arms
  for (const sx of [-1, 1]) box(teak, armW, 25 - baseTop, d, sx * (w / 2 - armW / 2), baseTop + (25 - baseTop) / 2, 0);
  // slatted back, leaning back ~12°
  const lean = -0.21;
  const backZ = -d / 2 + 2.5;
  for (let k = 0; k < 5; k++) box(teak, w - 2 * armW, 3.2, 1.4, 0, baseTop + 3 + k * 4.4, backZ - k * 0.95, lean);
  // seat cushion(s), back cushions, throw pillows
  const inner = w - 2 * armW;
  const seatW = inner / seats;
  // back posts at both ends and between seats
  for (let k = 0; k <= seats; k++) {
    const px = Math.min(Math.max(-inner / 2 + seatW * k, -inner / 2 + 1.1), inner / 2 - 1.1);
    box(teak, 2.2, 22, 1.6, px, baseTop + 11, backZ - 2.3, lean);
  }
  for (let k = 0; k < seats; k++) {
    const x = -inner / 2 + seatW * (k + 0.5);
    box(linen, seatW - 0.6, 5, d - 7, x, baseTop + 2.5, 2.5);
    box(linen, seatW - 0.8, 18, 5.5, x, baseTop + 5 + 9, backZ + 4.2, lean);
    box(pillowMat, Math.min(18, seatW - 6), 16, 4.5, x + (k % 2 ? 2 : -2), baseTop + 5 + 9, backZ + 9, lean * 0.6);
  }
  return g;
}

/** Dining chair sized so two sit between the oak table's legs (≤21¼" wide);
 * seat height derives from the tabletop (CHAIR_SEAT_H). Faces +z at yaw 0. */
function buildChair(): THREE.Group {
  const wood = tableMaterial('chair');
  const g = new THREE.Group();
  const seatW = 19;
  const seatD = 15.5;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(i2m(seatW), i2m(1.8), i2m(seatD)), wood);
  seat.position.set(0, i2m(CHAIR_SEAT_H - 0.9), i2m(0.75));
  seat.castShadow = seat.receiveShadow = true;
  g.add(seat);

  // bistro back: two stiles, rounded top rail, X cross slats
  const backZ = -(seatD / 2) + 0.4;
  const backH = CHAIR_BACK_H - CHAIR_SEAT_H;
  const stileGeo = new THREE.BoxGeometry(i2m(1.4), i2m(backH), i2m(1.4));
  for (const sx of [-1, 1]) {
    const stile = new THREE.Mesh(stileGeo, wood);
    stile.position.set(i2m(sx * (seatW / 2 - 1.2)), i2m((CHAIR_BACK_H + CHAIR_SEAT_H) / 2), i2m(backZ));
    stile.rotation.x = -0.09;
    stile.castShadow = true;
    g.add(stile);
  }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(i2m(0.9), i2m(0.9), i2m(seatW - 1.2), 8), wood);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, i2m(CHAIR_BACK_H - 0.9), i2m(backZ - 0.55));
  rail.castShadow = true;
  g.add(rail);
  const crossGeo = new THREE.BoxGeometry(i2m(1.2), i2m(Math.hypot(seatW - 3, backH - 4)), i2m(0.8));
  for (const sx of [-1, 1]) {
    const cross = new THREE.Mesh(crossGeo, wood);
    cross.position.set(0, i2m((CHAIR_BACK_H + CHAIR_SEAT_H) / 2 - 0.6), i2m(backZ));
    cross.rotation.x = -0.09;
    cross.rotation.z = sx * Math.atan2(seatW - 3, backH - 4);
    cross.castShadow = true;
    g.add(cross);
  }

  const legGeom = new THREE.BoxGeometry(i2m(1.6), i2m(CHAIR_SEAT_H - 1.8), i2m(1.6));
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const leg = new THREE.Mesh(legGeom, wood);
    leg.position.set(
      i2m(sx * (seatW / 2 - 1.2)),
      i2m((CHAIR_SEAT_H - 1.8) / 2),
      i2m(sz * (seatD / 2 - 1.2) + 0.75),
    );
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

/** Stylized low-poly guest mannequin. Proportions scale with height. */
function buildHuman(type: 'figureW' | 'figureM'): THREE.Group {
  const H = i2m(FIGURE_HEIGHTS[type]);
  const woman = type === 'figureW';
  const skin = tag(new THREE.MeshStandardMaterial({
    color: woman ? 0x8a7466 : 0x6f665c,
    roughness: 0.85,
    metalness: 0,
  }), 'skin', {}, 'skin');
  const hair = tag(new THREE.MeshStandardMaterial({ color: 0x3d332a, roughness: 0.9 }), 'generic', {}, 'hair');
  const g = new THREE.Group();
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  const headR = H * 0.064;
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 14), skin));
  head.position.y = H - headR;
  const cap = add(new THREE.Mesh(new THREE.SphereGeometry(headR * 1.04, 20, 12), hair));
  cap.position.set(0, H - headR * 0.92, -headR * 0.12);
  cap.scale.set(1, 0.82, 1);
  if (woman) {
    const bun = add(new THREE.Mesh(new THREE.SphereGeometry(headR * 0.42, 12, 10), hair));
    bun.position.set(0, H - headR * 1.15, -headR * 0.95);
  }

  const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.36, headR * 0.4, H * 0.035, 10), skin));
  neck.position.y = H - headR * 2 - H * 0.012;

  const shoulderHalf = H * (woman ? 0.105 : 0.125);
  const chest = add(new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.062, H * 0.16, 6, 14), skin));
  chest.position.y = H * 0.685;
  chest.scale.set(shoulderHalf / (H * 0.062), 1, 0.72);

  const pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(H * 0.062, 16, 12), skin));
  pelvis.position.y = H * 0.53;
  pelvis.scale.set(woman ? 1.55 : 1.35, 0.78, 0.95);

  const legLen = H * 0.47;
  const legGeom = new THREE.CapsuleGeometry(H * 0.042, legLen - H * 0.084, 6, 12);
  for (const s of [-1, 1]) {
    const leg = add(new THREE.Mesh(legGeom, skin));
    leg.position.set(s * H * 0.052, legLen / 2, 0);
  }

  const armLen = H * 0.4;
  const armGeom = new THREE.CapsuleGeometry(H * 0.028, armLen - H * 0.056, 6, 10);
  for (const s of [-1, 1]) {
    const arm = add(new THREE.Mesh(armGeom, skin));
    arm.position.set(s * (shoulderHalf + H * 0.024), H * 0.585, 0);
    arm.rotation.z = s * 0.08;
  }

  return g;
}

/** Candle lantern per the DutchCrafters outdoor family: square open frame,
 * pitched cap, real (dim) warm point light at the flame. */
function buildLantern(type: LanternType): THREE.Group {
  const spec = LANTERN_SPECS[type];
  const { w } = ITEM_DIMS[type];
  const h = spec.h;
  const frame = tag(new THREE.MeshStandardMaterial({ color: spec.colorHex, roughness: 0.6, metalness: 0.05 }), 'metal-dark', {}, 'lanternFrame');
  const g = new THREE.Group();
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const baseH = Math.max(1, h * 0.05);
  add(new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(baseH), i2m(w)), frame)).position.y = i2m(baseH / 2);
  const postT = Math.max(0.8, w * 0.09);
  const postH = h * 0.68;
  const postGeo = new THREE.BoxGeometry(i2m(postT), i2m(postH), i2m(postT));
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const post = add(new THREE.Mesh(postGeo, frame));
    post.position.set(i2m(sx * (w / 2 - postT / 2)), i2m(baseH + postH / 2), i2m(sz * (w / 2 - postT / 2)));
  }
  const collarY = baseH + postH;
  add(new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(1), i2m(w)), frame)).position.y = i2m(collarY + 0.5);
  const cap = add(
    new THREE.Mesh(new THREE.CylinderGeometry(0, i2m((w / 2) * 1.5), i2m(h - collarY - 1.5), 4), frame),
  );
  cap.rotation.y = Math.PI / 4;
  cap.position.y = i2m(collarY + 1 + (h - collarY - 1.5) / 2);
  const finial = add(new THREE.Mesh(new THREE.SphereGeometry(i2m(Math.max(0.6, w * 0.06)), 10, 8), frame));
  finial.position.y = i2m(h + 0.4);

  const candleH = h * 0.2;
  const candle = new THREE.Mesh(
    new THREE.CylinderGeometry(i2m(w * 0.14), i2m(w * 0.14), i2m(candleH), 12),
    tag(new THREE.MeshStandardMaterial({ color: 0xf6efdf, roughness: 0.7, emissive: 0x241505, emissiveIntensity: 0.4 }), 'generic', {}, 'candle'),
  );
  candle.position.y = i2m(baseH + candleH / 2);
  g.add(candle);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(i2m(Math.max(0.7, w * 0.075)), 10, 8),
    tag(new THREE.MeshStandardMaterial({ color: 0xffdf9e, emissive: 0xffa63c, emissiveIntensity: 2.4 }), 'emitter-flame', { luminance: 1200, castShadow: false }, 'flame'),
  );
  flame.scale.y = 1.6;
  flame.position.y = i2m(baseH + candleH + 1.1);
  g.add(flame);

  // ~13 lm candle: dim warm pool, no shadow casting (cheap per-lantern light)
  const light = new THREE.PointLight(0xffa550, spec.candela, i2m(175), 2);
  light.position.y = i2m(baseH + candleH + 2);
  g.add(light);
  return g;
}

/** Bright "Artificial Hedge": 48×10×96 — black wood planter box (48×10×10)
 * with a double-sided green hedge wall above. Blocks sun. */
function buildHedge(): THREE.Group {
  const { w, d } = ITEM_DIMS.hedge;
  const g = new THREE.Group();
  const leaf = tag(new THREE.MeshStandardMaterial({ color: 0x44543a, roughness: 0.95, flatShading: true }), 'foliage', { translucency: 0.25 }, 'hedgeLeaf');
  const body = new THREE.Mesh(new THREE.BoxGeometry(i2m(w - 1), i2m(HEDGE_H - 11), i2m(d - 2), 12, 20, 2), leaf);
  const pos = body.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const h = Math.sin(x * 61.7 + y * 43.3 + z * 89.1) * 0.5 + Math.sin(x * 17.9 - y * 23.7) * 0.5;
    const sfc = 1 + 0.05 * h;
    pos.setXYZ(k, x * sfc, y * sfc, z + Math.sign(z) * i2m(1.4) * Math.abs(h)); // leafy on both faces
  }
  body.geometry.computeVertexNormals();
  body.position.y = i2m(10 + (HEDGE_H - 11) / 2);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const planter = new THREE.Mesh(
    new THREE.BoxGeometry(i2m(w), i2m(10), i2m(d)),
    tag(new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.75, metalness: 0.05 }), 'metal-dark', {}, 'hedgeBox'),
  );
  planter.position.y = i2m(5);
  planter.castShadow = planter.receiveShadow = true;
  g.add(planter);
  return g;
}

/** Bright "Ivory Sausalito Screen": 48×21×90 — weighted walnut base
 * (48×21×21) on casters, single ivory fabric panel (48×2) rising to 90". */
function buildScreen(): THREE.Group {
  const g = new THREE.Group();
  const fabric = tag(new THREE.MeshStandardMaterial({ color: 0xf4efe3, roughness: 0.9 }), 'fabric', {}, 'screenPanel');
  const walnut = tag(new THREE.MeshStandardMaterial({ color: 0x5a4633, roughness: 0.6 }), 'wood-table', {}, 'screenWalnut');
  const base = new THREE.Mesh(new THREE.BoxGeometry(i2m(48), i2m(18), i2m(21)), walnut);
  base.position.y = i2m(3 + 9);
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  const casterGeo = new THREE.CylinderGeometry(i2m(1.5), i2m(1.5), i2m(1.6), 10);
  casterGeo.rotateZ(Math.PI / 2);
  const casterMat = tag(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 }), 'metal-dark', {}, 'caster');
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const caster = new THREE.Mesh(casterGeo, casterMat);
    caster.position.set(i2m(sx * 20), i2m(1.5), i2m(sz * 7.5));
    caster.castShadow = true;
    g.add(caster);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(i2m(48), i2m(SCREEN_H - 15), i2m(2)), fabric);
  panel.position.y = i2m(15 + (SCREEN_H - 15) / 2);
  panel.castShadow = panel.receiveShadow = true;
  g.add(panel);
  return g;
}

/** One guest's place as on the rental + purchase list. Rented Lucca Off White
 * stoneware (Bright Event Rentals): 10¾" dinner plate, 8" salad plate on it,
 * 9¾" wide-rim soup bowl on top (soup is served first), 12 oz mug at the
 * right; rented 12 oz standard water goblet. Bought: Nattie 18 oz red-wine
 * glass, Aspen 17 oz stemless (beer), Marin white linen napkin; the couple's
 * own flatware (dinner + salad fork on the napkin, knife and soup spoon at the
 * right). The menu card lies above the plate. The second salad plate (cake)
 * and second bowl (juk) come out with those courses. Local +z faces the
 * guest, +x is their right hand. Glass is transparent and catches sun/candle
 * light; stoneware shades softly. */
function buildSetting(): THREE.Group {
  const g = new THREE.Group();
  const stoneware = tag(new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 0.5, side: THREE.DoubleSide }), 'ceramic', {}, 'stoneware');
  const glass = tag(new THREE.MeshPhysicalMaterial({
    color: 0xf2f7fa,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), 'glass-tableware', { transmission: 1, ior: 1.5 }, 'tableGlass');
  // lathe a closed (r, y) profile in inches about the vertical axis at (x, z)
  const turn = (pts: [number, number][], mat: THREE.Material, x: number, y: number, z: number, segs = 32, shadows = true) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(i2m(r), i2m(h))), segs), mat);
    m.position.set(i2m(x), i2m(y), i2m(z));
    m.castShadow = m.receiveShadow = shadows;
    g.add(m);
    return m;
  };
  // plate: foot ring, flat well, flared rim rolled at the edge; top of the well
  // sits 0.34" up, so the next piece stacks there
  const PLATE_WELL = 0.34;
  const plate = (dia: number, foot: number, well: number, rimH: number, y: number) => {
    const R = dia / 2;
    turn([
      [0, 0.12], [foot - 0.2, 0.12], [foot, 0], [foot + 0.25, 0], [well, 0.12],
      [R - 0.12, rimH - 0.1], [R, rimH], [R - 0.08, rimH + 0.1],
      [R - 0.3, rimH + 0.02], [well - 0.1, PLATE_WELL], [0, PLATE_WELL],
    ], stoneware, -1.5, y, 0);
  };
  plate(10.75, 3.6, 3.9, 0.85, 0); // dinner 10¾"
  plate(8, 2.6, 2.9, 0.7, PLATE_WELL); // salad 8"
  // soup bowl 9¾": ~2" deep 6" well with a broad flat rim
  const bowlY = 2 * PLATE_WELL;
  turn([
    [0, 0.15], [1.7, 0.15], [1.9, 0], [2.15, 0], [2.9, 1.0], [3.3, 1.7], [4.75, 1.98],
    [4.875, 2.08], [4.8, 2.18], [3.25, 1.9], [2.75, 1.05], [2.0, 0.42], [0, 0.38],
  ], stoneware, -1.5, bowlY, 0);

  // 12 oz mug Ø3¼" × 4" right of the spoon, handle at four o'clock
  const MUG_X = 9.2;
  const MUG_Z = 1.6;
  turn([
    [0, 0.1], [1.35, 0.1], [1.45, 0], [1.6, 0.06], [1.625, 0.5], [1.625, 3.94], [1.56, 4],
    [1.48, 3.94], [1.48, 0.55], [1.3, 0.38], [0, 0.36],
  ], stoneware, MUG_X, 0, MUG_Z, 28);
  const handleDir = Math.PI / 4; // from +x toward the guest
  const handle = new THREE.Mesh(new THREE.TorusGeometry(i2m(1.0), i2m(0.21), 8, 16, Math.PI), stoneware);
  handle.rotation.set(0, -handleDir, -Math.PI / 2); // half-ring standing out along handleDir
  handle.position.set(i2m(MUG_X + 1.55 * Math.cos(handleDir)), i2m(2.1), i2m(MUG_Z + 1.55 * Math.sin(handleDir)));
  handle.castShadow = handle.receiveShadow = true;
  g.add(handle);

  // glassware in a triangle above the knife: water goblet 12 oz (6½" tall,
  // foot Ø3", tulip bowl), Nattie red wine 18 oz (≈8¾", wide bowl), Aspen
  // stemless 17 oz (≈4½") for beer
  turn([
    [0, 0], [1.5, 0], [1.5, 0.12], [0.4, 0.3], [0.2, 0.7], [0.2, 2.3], [0.55, 2.6],
    [1.2, 3.1], [1.6, 3.9], [1.65, 4.8], [1.55, 6.5],
  ], glass, 5.6, 0, -7.4, 24, false);
  turn([
    [0, 0], [1.6, 0], [1.6, 0.12], [0.4, 0.3], [0.17, 0.8], [0.17, 3.6], [0.6, 3.9],
    [1.4, 4.4], [1.85, 5.4], [1.9, 6.6], [1.6, 8.0], [1.4, 8.75],
  ], glass, 9.0, 0, -5.2, 24, false);
  turn([
    [0, 0.25], [1.2, 0.25], [1.3, 0], [1.55, 0.2], [1.75, 1.6], [1.75, 2.8], [1.6, 4.5],
  ], glass, 7.2, 0, -10.8, 24, false);

  // couple's own flatware, stainless, laid lengthwise (heads toward the table
  // centre): dinner + salad fork on the napkin, knife (blade in) and soup spoon
  const steel = tag(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.25, metalness: 1 }), 'metal-stainless', {}, 'flatware');
  const flat = (w: number, len: number, x: number, z: number, y: number, t = 0.12) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(t), i2m(len)), steel);
    m.position.set(i2m(x), i2m(y + t / 2), i2m(z));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const fork = (x: number, len: number, y: number) => {
    const z0 = 3.2; // handle end toward the guest
    const head = 2.4;
    flat(0.42, len - head, x, z0 - (len - head) / 2, y);
    flat(0.95, 0.5, x, z0 - (len - head) - 0.25, y);
    for (const k of [-1.5, -0.5, 0.5, 1.5]) flat(0.14, head - 0.5, x + k * 0.26, z0 - len + (head - 0.5) / 2, y);
  };
  const NAP_X = -9.4;
  fork(NAP_X - 0.75, 7.6, 0.5); // dinner fork
  fork(NAP_X + 0.85, 6.6, 0.5); // salad fork
  flat(0.38, 4.8, 4.9, 3.2 - 2.4, 0); // knife handle
  flat(0.7, 4.2, 4.95, 3.2 - 4.8 - 2.1, 0, 0.06); // knife blade
  flat(0.36, 5.2, 6.5, 3.2 - 2.6, 0); // soup spoon handle
  const spoonBowl = new THREE.Mesh(new THREE.SphereGeometry(i2m(1), 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel);
  spoonBowl.scale.set(0.8, 0.28, 1.25);
  spoonBowl.position.set(i2m(6.5), i2m(0.3), i2m(3.2 - 5.2 - 1.15));
  spoonBowl.castShadow = spoonBowl.receiveShadow = true;
  g.add(spoonBowl);

  // Marin white linen napkin folded at the left, forks on it
  const napkin = new THREE.Mesh(
    new THREE.BoxGeometry(i2m(4.0), i2m(0.5), i2m(8.4)),
    tag(new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.85 }), 'linen', { sheen: 0.5 }, 'napkin'),
  );
  napkin.position.set(i2m(NAP_X), i2m(0.25), 0);
  napkin.castShadow = napkin.receiveShadow = true;
  g.add(napkin);

  // menu card lying across the top of the place: ivory face inside green
  // bridal edges
  const MENU_X = -1.6;
  const MENU_Z = -8.6;
  const menuGreen = tag(new THREE.MeshStandardMaterial({ color: 0x5c7053, roughness: 0.8 }), 'generic', {}, 'menuGreen');
  const menuIvory = tag(new THREE.MeshStandardMaterial({ color: 0xfbf8ef, roughness: 0.72 }), 'generic', {}, 'menuIvory');
  const menuBorder = new THREE.Mesh(new THREE.BoxGeometry(i2m(8.75), i2m(0.12), i2m(4.5)), menuGreen);
  menuBorder.position.set(i2m(MENU_X), i2m(0.06), i2m(MENU_Z));
  menuBorder.castShadow = menuBorder.receiveShadow = true;
  g.add(menuBorder);
  const menuFace = new THREE.Mesh(new THREE.BoxGeometry(i2m(8.31), i2m(0.08), i2m(4.06)), menuIvory);
  menuFace.position.set(i2m(MENU_X), i2m(0.14), i2m(MENU_Z));
  menuFace.receiveShadow = true;
  g.add(menuFace);
  const ink = tag(new THREE.MeshStandardMaterial({ color: 0x76806b, roughness: 0.9 }), 'generic', {}, 'ink');
  const menuLine = (xOff: number, wIn: number) => {
    // text runs left to right as the guest reads it; lines stack toward them
    const m = new THREE.Mesh(new THREE.BoxGeometry(i2m(wIn), i2m(0.03), i2m(0.32)), ink);
    m.position.set(i2m(MENU_X), i2m(0.19), i2m(MENU_Z + xOff));
    g.add(m);
  };
  menuLine(-1.45, 2.3); // MENU header
  menuLine(-0.55, 4.6);
  menuLine(0.25, 4.0);
  menuLine(1.05, 4.6);
  menuLine(1.75, 3.4);
  return g;
}

// ---------------------------------------------------------------------------
// Pottery Pots planters (Diorite Grey fiberstone) + the plants that fill them
// ---------------------------------------------------------------------------

let dioriteMat: THREE.MeshStandardMaterial | null = null;
function dioriteMaterial(): THREE.MeshStandardMaterial {
  if (!dioriteMat) {
    const tex = dioriteTextures();
    dioriteMat = tag(new THREE.MeshStandardMaterial({
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      bumpMap: tex.bumpMap,
      bumpScale: 0.012,
      roughness: 0.9,
      metalness: 0,
    }), 'stone', {}, 'diorite');
  }
  return dioriteMat;
}

let soilMat: THREE.MeshStandardMaterial | null = null;
function soilMaterial(): THREE.MeshStandardMaterial {
  if (!soilMat) soilMat = tag(new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 1, metalness: 0 }), 'soil', {}, 'potSoil');
  return soilMat;
}

/** Lathe profile per family: up the outer wall, then a rim return inward and
 * down to just below the soil line so the pot interior reads from above. */
function potProfile(type: PlanterType): THREE.Vector2[] {
  const { dia, h, openingDia, soilDrop, family } = PLANTER_SPECS[type];
  const R = dia / 2;
  const openR = openingDia / 2;
  const pts: [number, number][] = [];
  if (family === 'harith') {
    // near-cylinder with the chamfered conical lower third
    pts.push([0.3 * R, 0], [0.64 * R, 0.02 * h], [0.97 * R, 0.34 * h], [0.99 * R, 0.6 * h], [R, 0.95 * h], [R, h]);
  } else if (family === 'cody') {
    // egg cup: rounded bowl bottom, walls curling slightly inward at the lip
    pts.push(
      [0.3 * R, 0],
      [0.48 * R, 0.02 * h],
      [0.74 * R, 0.1 * h],
      [0.92 * R, 0.26 * h],
      [R, 0.52 * h],
      [0.995 * R, 0.74 * h],
      [0.955 * R, 0.9 * h],
      [0.965 * R, 0.965 * h],
      [0.96 * R, h],
    );
  } else {
    // jesslyn: flat small base, smooth concave flare to a wide top
    const r0 = 0.42 * R;
    pts.push([r0, 0]);
    for (let i = 1; i <= 7; i++) {
      const t = i / 7;
      pts.push([r0 + (R - r0) * Math.pow(t, 0.8), t * h]);
    }
  }
  pts.push([openR, h], [openR * 0.98, h - soilDrop - 0.4]);
  return pts.map(([r, y]) => new THREE.Vector2(i2m(r), i2m(y)));
}

function buildPlanter(type: PlanterType): THREE.Group {
  const { h, openingDia, soilDrop } = PLANTER_SPECS[type];
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potProfile(type), 24), dioriteMaterial());
  pot.castShadow = pot.receiveShadow = true;
  g.add(pot);
  const soilR = openingDia / 2 - 0.1;
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(i2m(soilR), i2m(soilR), i2m(0.6), 20), soilMaterial());
  soil.position.y = i2m(h - soilDrop - 0.3); // top face exactly at the soil line
  soil.receiveShadow = true;
  g.add(soil);
  return g;
}

/** Boston fern: 14 tapered fronds arching outward on golden-angle spokes. */
function buildPlantFern(): THREE.Group {
  const g = new THREE.Group();
  const dark = tag(new THREE.MeshStandardMaterial({ color: 0x3e5a34, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.3 }, 'fernDark');
  const light = tag(new THREE.MeshStandardMaterial({ color: 0x4e6a40, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.3 }, 'fernLight');
  // kept light and upright so the pot shows under it
  for (let k = 0; k < 14; k++) {
    const len = 9 + 3 * Math.abs(Math.sin(k * 2.7));
    const geo = new THREE.PlaneGeometry(i2m(1.7), i2m(len), 1, 4);
    geo.translate(0, i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / i2m(len);
      pos.setX(i, pos.getX(i) * (1 - 0.75 * t * t)); // taper to the tip
      pos.setZ(i, pos.getZ(i) + i2m(2.6) * t * t); // arching droop
    }
    geo.computeVertexNormals();
    const frond = new THREE.Mesh(geo, k % 3 ? dark : light);
    frond.rotation.order = 'YXZ';
    frond.rotation.y = k * 2.39996;
    frond.rotation.x = -(0.35 + 0.35 * Math.abs(Math.sin(k * 1.3))); // lean 20–40° outward
    frond.castShadow = true;
    g.add(frond);
  }
  return g;
}

/** Boxwood ball: displaced sphere, same leaf noise as the hedge. */
function buildPlantBoxwood(): THREE.Group {
  const g = new THREE.Group();
  const leaf = tag(new THREE.MeshStandardMaterial({ color: 0x44543a, roughness: 0.95, flatShading: true }), 'foliage', { translucency: 0.2 }, 'boxwood');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(i2m(7), 20, 14), leaf);
  const pos = ball.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const n = Math.sin(x * 61.7 + y * 43.3 + z * 89.1) * 0.5 + Math.sin(x * 17.9 - y * 23.7) * 0.5;
    const sfc = 1 + 0.06 * n;
    pos.setXYZ(k, x * sfc, y * sfc, z * sfc);
  }
  ball.geometry.computeVertexNormals();
  ball.position.y = i2m(7.5);
  ball.castShadow = ball.receiveShadow = true;
  g.add(ball);
  return g;
}

/** Snake plant: 11 upright pinched blades on two rings, two-tone greens. */
function buildPlantSnake(): THREE.Group {
  const g = new THREE.Group();
  const dark = tag(new THREE.MeshStandardMaterial({ color: 0x3c5232, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.2 }, 'snakeDark');
  const light = tag(new THREE.MeshStandardMaterial({ color: 0x59714a, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.2 }, 'snakeLight');
  for (let k = 0; k < 11; k++) {
    const len = 18 + 8 * Math.abs(Math.sin(k * 1.7));
    const geo = new THREE.PlaneGeometry(i2m(2.4), i2m(len), 1, 3);
    geo.translate(0, i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / i2m(len);
      pos.setX(i, pos.getX(i) * (1 - 0.75 * (Math.max(0, t - 0.66) / 0.34))); // pinched tip
      pos.setZ(i, pos.getZ(i) + i2m(1.2) * Math.sin(t * Math.PI)); // slight belly
    }
    geo.computeVertexNormals();
    const blade = new THREE.Mesh(geo, k % 2 ? dark : light);
    const ring = k < 5 ? 1.5 : 3.2;
    const a = k * 2.39996;
    blade.position.set(i2m(ring * Math.cos(a)), 0, i2m(ring * Math.sin(a)));
    blade.rotation.y = a + 0.2 * Math.sin(k * 3.1);
    blade.rotation.z = 0.06 * Math.sin(k * 5.3);
    blade.castShadow = true;
    g.add(blade);
  }
  return g;
}

/** Fountain grass: 48 thin blades arcing outward from a golden-angle spiral. */
function buildPlantGrass(): THREE.Group {
  const g = new THREE.Group();
  const green = tag(new THREE.MeshStandardMaterial({ color: 0x6a7a4a, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.35 }, 'grassGreen');
  const straw = tag(new THREE.MeshStandardMaterial({ color: 0x8a9464, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }), 'foliage', { translucency: 0.35 }, 'grassStraw');
  for (let k = 0; k < 48; k++) {
    const len = 14 + 10 * Math.abs(Math.sin(k * 2.1));
    const geo = new THREE.PlaneGeometry(i2m(0.55), i2m(len), 1, 3);
    geo.translate(0, i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / i2m(len);
      pos.setZ(i, pos.getZ(i) + i2m(6) * t * t); // fountain arc
      pos.setX(i, pos.getX(i) * (1 - 0.5 * t));
    }
    geo.computeVertexNormals();
    const blade = new THREE.Mesh(geo, k % 5 ? green : straw);
    const a = k * 2.39996;
    const r = 4 * Math.sqrt((k + 0.5) / 48);
    blade.position.set(i2m(r * Math.cos(a)), 0, i2m(r * Math.sin(a)));
    blade.rotation.y = Math.PI / 2 - a; // arc faces outward
    blade.castShadow = true;
    g.add(blade);
  }
  return g;
}

/** Small olive tree: leaning kinked trunk, three silvery displaced canopies. */
function buildPlantOlive(): THREE.Group {
  const g = new THREE.Group();
  const bark = tag(new THREE.MeshStandardMaterial({ color: 0x6e6154, roughness: 0.9, flatShading: true }), 'bark', {}, 'oliveBark');
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(i2m(0.9), i2m(1.5), i2m(24), 7, 3), bark);
  const tp = trunk.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const t = tp.getY(i) / i2m(24) + 0.5;
    tp.setX(i, tp.getX(i) + i2m(1.6) * t * t); // gentle lean
  }
  trunk.geometry.computeVertexNormals();
  trunk.position.y = i2m(12);
  trunk.castShadow = true;
  g.add(trunk);
  const leaf = tag(new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 0.95, flatShading: true }), 'foliage', { translucency: 0.3 }, 'oliveLeaf');
  const canopy = (r: number, cx: number, cy: number, cz: number, seed: number) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(i2m(r), 14, 10), leaf);
    const pos = s.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = Math.sin(x * 61.7 + y * 43.3 + z * 89.1 + seed) * 0.5 + Math.sin(x * 17.9 - y * 23.7 + seed) * 0.5;
      const sfc = 1 + 0.09 * n;
      pos.setXYZ(i, x * sfc, y * sfc, z * sfc);
    }
    s.geometry.computeVertexNormals();
    s.position.set(i2m(cx), i2m(cy), i2m(cz));
    s.castShadow = true;
    g.add(s);
  };
  canopy(7, 1.6, 32, 0, 0);
  canopy(5, -2.8, 28, 2.4, 2);
  canopy(4.6, 4, 27, -3.2, 4);
  return g;
}

/** Fern moss tree: ~5' weeping fern — a mossy stem carrying tiers of long
 * leaflet-notched fronds that arch out and drape toward the floor, with thin
 * moss strands hanging through them. Pale, faintly luminous frost-green so it
 * reads dreamy under the evening sun. Fits every planter (10" rootball). */
function buildPlantMossTree(): THREE.Group {
  const g = new THREE.Group();
  const TOP = 58;
  const frondA = tag(new THREE.MeshStandardMaterial({
    color: 0xa3c48c,
    emissive: 0x1f3018,
    emissiveIntensity: 0.35,
    roughness: 0.85,
    side: THREE.DoubleSide,
  }), 'foliage', { translucency: 0.3 }, 'mossFrondA');
  const frondB = tag(new THREE.MeshStandardMaterial({
    color: 0x7fa66a,
    emissive: 0x172a14,
    emissiveIntensity: 0.3,
    roughness: 0.85,
    side: THREE.DoubleSide,
  }), 'foliage', { translucency: 0.3 }, 'mossFrondB');
  const mossMat = tag(new THREE.MeshStandardMaterial({
    color: 0x8fb078,
    emissive: 0x1c2c16,
    emissiveIntensity: 0.3,
    roughness: 0.95,
    side: THREE.DoubleSide,
  }), 'foliage', { translucency: 0.2 }, 'mossStem');
  // the only pale note: whitish moss threads hanging through the green
  const threadMat = tag(new THREE.MeshStandardMaterial({
    color: 0xe6eddc,
    emissive: 0x2a3323,
    emissiveIntensity: 0.25,
    roughness: 0.95,
    side: THREE.DoubleSide,
  }), 'foliage', { translucency: 0.3 }, 'mossThread');

  // moss-clad stem: a lumpy pale column, no bare bark
  const stemH = TOP - 10;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(i2m(1.4), i2m(2.2), i2m(stemH), 9, 10), mossMat);
  const sp = stem.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const y = sp.getY(i);
    const z = sp.getZ(i);
    const n = Math.sin(x * 90 + y * 37) * 0.5 + Math.sin(z * 70 - y * 23) * 0.5;
    const sfc = 1 + 0.22 * n;
    sp.setXYZ(i, x * sfc + i2m(0.9) * (y / i2m(stemH) + 0.5) ** 2, y, z * sfc);
  }
  stem.geometry.computeVertexNormals();
  stem.position.y = i2m(stemH / 2);
  stem.castShadow = true;
  g.add(stem);

  // crown dome of moss at the top
  const dome = new THREE.Mesh(new THREE.SphereGeometry(i2m(4.5), 14, 10), mossMat);
  const dp = dome.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i);
    const y = dp.getY(i);
    const z = dp.getZ(i);
    const n = Math.sin(x * 61.7 + y * 43.3 + z * 89.1) * 0.5 + Math.sin(x * 17.9 - y * 23.7) * 0.5;
    const sfc = 1 + 0.12 * n;
    dp.setXYZ(i, x * sfc, y * sfc * 0.8, z * sfc);
  }
  dome.geometry.computeVertexNormals();
  dome.position.set(i2m(0.9), i2m(TOP - 5), 0);
  dome.castShadow = true;
  g.add(dome);

  // weeping fronds in tiers: arch out from the stem, then drape down;
  // leaflets suggested by a scalloped edge along the blade
  const fronds = 84;
  for (let k = 0; k < fronds; k++) {
    const a = k * 2.39996;
    const tier = k % 6; // 0 = top tier
    const baseY = TOP - 6 - tier * 5.5;
    const len = 20 + 14 * Math.abs(Math.sin(k * 1.7)) + tier * 1.2; // 20–40"
    const reach = 7 + 8 * Math.abs(Math.sin(k * 0.9)); // how far it arches out
    const geo = new THREE.PlaneGeometry(i2m(2.6), i2m(len), 1, 10);
    geo.translate(0, i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / i2m(len); // 0 base, 1 tip
      // rise a little, arch outward, then fall well below the base: weeping
      const y = i2m(len) * (0.28 * Math.sin(t * Math.PI) - 0.85 * t * t);
      const z = i2m(reach) * Math.sin(t * Math.PI * 0.62) + i2m(reach * 0.35) * t;
      const taper = 1 - 0.7 * t;
      const scallop = 0.72 + 0.28 * Math.abs(Math.sin(t * len * 1.6)); // leaflet notches
      pos.setXYZ(i, pos.getX(i) * taper * scallop, y, z);
    }
    geo.computeVertexNormals();
    const frond = new THREE.Mesh(geo, k % 3 ? frondA : frondB);
    const stemOff = 0.9 * ((baseY / stemH) ** 2); // follow the stem's lean
    frond.position.set(i2m(stemOff + 1.6 * Math.cos(a)), i2m(baseY), i2m(1.6 * Math.sin(a)));
    frond.rotation.y = Math.PI / 2 - a;
    frond.rotation.z = 0.08 * Math.sin(k * 3.3);
    frond.castShadow = true;
    g.add(frond);
  }

  // moss strands: thin pale threads hanging straight through the fronds
  for (let k = 0; k < 46; k++) {
    const a = k * 2.39996 + 0.7;
    const len = 12 + 16 * Math.abs(Math.sin(k * 2.3));
    const r = 4 + 7 * ((k % 5) / 4);
    const geo = new THREE.PlaneGeometry(i2m(0.32), i2m(len), 1, 5);
    geo.translate(0, -i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i) / i2m(len);
      pos.setX(i, pos.getX(i) + i2m(0.6) * Math.sin(t * 5 + k));
    }
    const strand = new THREE.Mesh(geo, threadMat);
    const hangY = TOP - 12 - 14 * ((k % 4) / 3);
    strand.position.set(i2m(0.6 + r * Math.cos(a)), i2m(hangY), i2m(r * Math.sin(a)));
    strand.rotation.y = -a;
    g.add(strand);
  }
  return g;
}

/** Coast rosemary (Westringia fruticosa), ~2½': a couple dozen thin woody stems
 * fanning up and outward from the base, each clothed in whorls of tiny
 * silvery grey-green needle leaves — airy, sprawling, wider at the top.
 * Everything is merged into two geometries so cloning stays cheap. */
function buildPlantRosemary(): THREE.Group {
  const g = new THREE.Group();
  const stemPos: number[] = [];
  const leafPos: number[] = [];
  const leafCol: number[] = [];
  const quad = (
    out: number[],
    c: THREE.Vector3,
    u: THREE.Vector3,
    v: THREE.Vector3,
  ) => {
    const a = c.clone().sub(u).sub(v);
    const b = c.clone().add(u).sub(v);
    const d = c.clone().add(u).add(v);
    const e = c.clone().sub(u).add(v);
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z, a.x, a.y, a.z, d.x, d.y, d.z, e.x, e.y, e.z);
  };
  const silver = new THREE.Color(0x98ab93);
  const pale = new THREE.Color(0xc3d0bb);
  const deep = new THREE.Color(0x7f927a);
  const tmpC = new THREE.Color();

  // one spray: a curved stem from `origin` along `dir`, clothed in needle whorls
  const spray = (
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    len: number,
    droop: number,
    seed: number,
    thick: number,
  ) => {
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const pt = (t: number) => {
      const p = dir.clone().multiplyScalar(i2m(len) * t);
      p.y -= i2m(len) * droop * t * t;
      p.addScaledVector(side, i2m(1.4) * Math.sin(t * 7 + seed)); // gentle wander
      return p.add(origin);
    };
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const p0 = pt(i / segs);
      const p1 = pt((i + 1) / segs);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const axis = p1.clone().sub(p0);
      const half = axis.clone().multiplyScalar(0.5);
      const w = i2m(thick * (1 - 0.6 * (i / segs)));
      const n1 = new THREE.Vector3().crossVectors(axis, up).normalize().multiplyScalar(w);
      const n2 = new THREE.Vector3().crossVectors(axis, n1).normalize().multiplyScalar(w);
      quad(stemPos, mid, half, n1);
      quad(stemPos, mid, half, n2);
    }
    const whorls = Math.round(len / 0.95);
    for (let j = 0; j < whorls; j++) {
      const t = 0.15 + 0.85 * (j / whorls);
      const c = pt(t);
      const tangent = pt(t + 0.02).sub(c).normalize();
      const s1 = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const s2 = new THREE.Vector3().crossVectors(tangent, s1).normalize();
      const needles = 5;
      for (let n = 0; n < needles; n++) {
        const ang = (n / needles) * Math.PI * 2 + j * 0.9 + seed;
        const out = s1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s2, Math.sin(ang));
        const nl = i2m(1.2 + 0.9 * Math.abs(Math.sin(j * 2.1 + n + seed)));
        const centre = c.clone().addScaledVector(out, nl * 0.5).addScaledVector(tangent, nl * 0.4);
        const u = out.clone().multiplyScalar(nl * 0.5).addScaledVector(tangent, nl * 0.4);
        const v = new THREE.Vector3().crossVectors(u, tangent).normalize().multiplyScalar(i2m(0.09));
        quad(leafPos, centre, u, v);
        tmpC.copy(j % 3 === 0 ? deep : silver).lerp(pale, t * 0.5);
        for (let q = 0; q < 6; q++) leafCol.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }
    return pt;
  };

  // trimmed: a sparse, upright plant (~22" across) rather than a sprawling
  // shrub, so it frames the couple and its pot stays in view
  const stems = 28;
  const up = new THREE.Vector3(0, 1, 0);
  const base = new THREE.Vector3(0, i2m(0.6), 0);
  for (let k = 0; k < stems; k++) {
    const az = k * 2.39996;
    const elev = 1.08 + 0.4 * Math.abs(Math.sin(k * 1.31)); // 62°–85° from horizontal
    const len = 16 + 10 * Math.abs(Math.sin(k * 0.77)); // 16–26"
    const droop = 0.08 + 0.12 * (1 - elev / 1.48);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const pt = spray(base, dir, len, droop, k, 0.2);
    // a wispy side spray off the upper half of each stem
    for (let b = 0; b < 1; b++) {
      const t0 = 0.45 + 0.25 * b + 0.1 * Math.abs(Math.sin(k * 3.7 + b));
      const o = pt(t0);
      const tan = pt(t0 + 0.02).sub(o).normalize();
      const sideV = new THREE.Vector3().crossVectors(tan, up).normalize();
      const bdir = tan
        .clone()
        .addScaledVector(sideV, (b ? -1 : 1) * (0.45 + 0.3 * Math.abs(Math.sin(k * 1.9))))
        .addScaledVector(up, 0.25)
        .normalize();
      spray(o, bdir, 10 + 8 * Math.abs(Math.sin(k * 2.3 + b)), 0.35, k * 7 + b, 0.1);
    }
  }

  const stemGeo = new THREE.BufferGeometry();
  stemGeo.setAttribute('position', new THREE.Float32BufferAttribute(stemPos, 3));
  stemGeo.computeVertexNormals();
  const stemMesh = new THREE.Mesh(
    stemGeo,
    tag(new THREE.MeshStandardMaterial({ color: 0x8a8272, roughness: 0.9, side: THREE.DoubleSide }), 'bark', {}, 'rosemaryStem'),
  );
  stemMesh.castShadow = true;
  g.add(stemMesh);

  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(leafPos, 3));
  leafGeo.setAttribute('color', new THREE.Float32BufferAttribute(leafCol, 3));
  leafGeo.computeVertexNormals();
  const leafMesh = new THREE.Mesh(
    leafGeo,
    tag(new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0x1c2219,
      emissiveIntensity: 0.15,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }), 'foliage', { translucency: 0.3 }, 'rosemaryLeaf'),
  );
  leafMesh.castShadow = true;
  g.add(leafMesh);
  return g;
}

function buildPlant(type: PlantType): THREE.Group {
  switch (type) {
    case 'plantFern':
      return buildPlantFern();
    case 'plantBoxwood':
      return buildPlantBoxwood();
    case 'plantSnake':
      return buildPlantSnake();
    case 'plantGrass':
      return buildPlantGrass();
    case 'plantOlive':
      return buildPlantOlive();
    case 'plantMossTree':
      return buildPlantMossTree();
    case 'plantRosemary':
      return buildPlantRosemary();
  }
}

/** Tallest planter soil surface under a floor point (0 = open floor) —
 * plants mount on it, mirroring how lanterns/settings ride tabletops. */
export function planterSoilUnder(items: PlacedItem[], x: number, z: number): number {
  let top = 0;
  for (const it of items) {
    if (!isPlanter(it.type)) continue;
    const spec = PLANTER_SPECS[it.type];
    if (Math.hypot(x - it.x, z - it.z) <= spec.openingDia / 2) {
      top = Math.max(top, spec.h - spec.soilDrop);
    }
  }
  return top;
}

/** Tallest tabletop under a floor point (0 = open floor) — lanterns mount on it. */
export function tableTopUnder(items: PlacedItem[], x: number, z: number): number {
  let top = 0;
  for (const it of items) {
    if (!isTable(it.type)) continue;
    const dims = it.dims ?? ITEM_DIMS[it.type];
    const local = unrot(x - it.x, z - it.z, it.yawDeg * DEG);
    if (Math.abs(local.x) <= dims.w / 2 && Math.abs(local.z) <= dims.d / 2) {
      top = Math.max(top, it.dims?.h ?? TABLE_TOPS[it.type]);
    }
  }
  return top;
}

function getTemplate(type: ItemType): THREE.Group {
  let template = templates.get(type);
  if (!template) {
    if (isTable(type)) template = buildTableTemplate(type);
    else if (type === 'chair') template = buildChair();
    else if (type === 'loungeSofa' || type === 'loungeChair') template = buildLounge(type);
    else if (isLantern(type)) template = buildLantern(type);
    else if (type === 'hedge') template = buildHedge();
    else if (type === 'screen') template = buildScreen();
    else if (type === 'setting') template = buildSetting();
    else if (isPlanter(type)) template = buildPlanter(type);
    else if (isPlant(type)) template = buildPlant(type);
    else template = buildHuman(type as 'figureW' | 'figureM');
    templates.set(type, template);
  }
  return template.clone();
}

function getTableOutline(type: TableType): THREE.BufferGeometry {
  let geom = tableOutlines.get(type);
  if (!geom) {
    const { w, d } = ITEM_DIMS[type];
    geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(i2m(w), i2m(TABLE_TOP_T), i2m(d)));
    tableOutlines.set(type, geom);
  }
  return geom;
}

export class ItemMeshes {
  private parent: THREE.Group;
  private meshes = new Map<string, THREE.Group>();
  private outlines = new Map<string, THREE.LineSegments>();
  private hiddenId: string | null = null;
  private selectedIds: string[] = [];
  private hoveredId: string | null = null;
  private plates: THREE.Mesh[] = [];
  private plateProto: THREE.Mesh;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.plateProto = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: COLORS.brass,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    this.plateProto.rotation.x = -Math.PI / 2;
    this.plateProto.visible = false;
  }

  /** Everything except cloths — cloth meshes belong to the ClothManager.
   * `extraTop` lets later-placed decor ride settled cloth surfaces. */
  sync(items: PlacedItem[], extraTop?: (it: PlacedItem) => number): void {
    const wanted = new Map(
      items
        // derived, so new item types can't be left out (cloths belong to the
        // ClothManager)
        .filter((it) => !it.type.startsWith('cloth'))
        .map((it) => [it.id, it]),
    );
    for (const [id, mesh] of this.meshes) {
      if (!wanted.has(id)) {
        this.parent.remove(mesh);
        this.meshes.delete(id);
        const outline = this.outlines.get(id);
        if (outline) {
          (outline.material as THREE.Material).dispose(); // geometry is shared
          this.outlines.delete(id);
        }
      }
    }
    for (const [id, it] of wanted) {
      let mesh = this.meshes.get(id);
      const dimsKey = it.type === 'tableC' ? JSON.stringify(it.dims ?? null) : '';
      if (mesh && it.type === 'tableC' && mesh.userData.dimsKey !== dimsKey) {
        this.parent.remove(mesh);
        this.meshes.delete(id);
        mesh = undefined;
      }
      if (!mesh) {
        mesh = it.type === 'tableC' ? buildTableTemplate('tableC', it.dims) : getTemplate(it.type);
        mesh.userData.dimsKey = dimsKey;
        mesh.traverse((o) => {
          o.userData.itemId = id;
        });
        mesh.userData.itemId = id;
        this.parent.add(mesh);
        this.meshes.set(id, mesh);
        if (isTable(it.type)) {
          const od = it.dims ?? ITEM_DIMS[it.type];
          const outline = new THREE.LineSegments(
            it.type === 'tableC'
              ? new THREE.EdgesGeometry(new THREE.BoxGeometry(i2m(od.w), i2m(TABLE_TOP_T), i2m(od.d)))
              : getTableOutline(it.type),
            new THREE.LineBasicMaterial({ color: COLORS.brass, transparent: true, opacity: 0.95 }),
          );
          outline.position.y = i2m((it.dims?.h ?? TABLE_TOPS[it.type]) - TABLE_TOP_T / 2);
          outline.visible = false;
          mesh.add(outline);
          this.outlines.set(id, outline);
        }
      }
      const mountY =
        isLantern(it.type) || it.type === 'setting'
          ? Math.max(tableTopUnder(items, it.x, it.z), extraTop ? extraTop(it) : 0)
          : isPlant(it.type)
            ? planterSoilUnder(items, it.x, it.z)
            : 0;
      mesh.position.set(i2m(it.x), i2m(mountY), i2m(it.z));
      mesh.rotation.y = it.yawDeg * DEG;
      mesh.visible = id !== this.hiddenId;
    }
    this.refreshHighlights(items);
  }

  /** Hide the original while its ghost is being dragged. */
  setHidden(id: string | null): void {
    if (this.hiddenId && this.meshes.has(this.hiddenId)) {
      this.meshes.get(this.hiddenId)!.visible = true;
    }
    this.hiddenId = id;
    if (id && this.meshes.has(id)) this.meshes.get(id)!.visible = false;
  }

  setSelected(ids: string[], items: PlacedItem[]): void {
    this.selectedIds = ids;
    this.refreshHighlights(items);
  }

  /** Returns true when the hover state actually changed (needs a render). */
  setHovered(id: string | null, items: PlacedItem[]): boolean {
    if (this.hoveredId === id) return false;
    this.hoveredId = id;
    this.refreshHighlights(items);
    return true;
  }

  private refreshHighlights(items: PlacedItem[]): void {
    for (const [id, outline] of this.outlines) {
      const mat = outline.material as THREE.LineBasicMaterial;
      if (this.selectedIds.includes(id)) {
        outline.visible = true;
        mat.color.setHex(COLORS.brass);
      } else if (id === this.hoveredId) {
        outline.visible = true;
        mat.color.setHex(COLORS.hover);
      } else {
        outline.visible = false;
      }
    }
    // one brass floor plate under every selected item (pool grows on demand)
    const sels = items.filter((it) => this.selectedIds.includes(it.id) && it.id !== this.hiddenId);
    while (this.plates.length < sels.length) {
      const p = this.plateProto.clone();
      this.parent.add(p);
      this.plates.push(p);
    }
    this.plates.forEach((p, i) => {
      const sel = sels[i];
      if (!sel) {
        p.visible = false;
        return;
      }
      const dims = ITEM_DIMS[sel.type];
      p.visible = true;
      p.scale.set(i2m(dims.w + 8), i2m(dims.d + 8), 1);
      p.position.set(i2m(sel.x), i2m(0.3), i2m(sel.z));
      p.rotation.z = sel.yawDeg * DEG;
    });
  }

  getMesh(id: string): THREE.Group | undefined {
    return this.meshes.get(id);
  }
}
