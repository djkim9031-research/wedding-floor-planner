import * as THREE from 'three';
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
  isFigure,
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
    mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bumpMap,
      bumpScale: 0.015,
      roughness: key === 'teak' ? 0.45 : 0.5,
      metalness: 0,
    });
    woodMaterials.set(key, mat);
  }
  return mat;
}

const templates = new Map<ItemType, THREE.Group>();
const tableOutlines = new Map<TableType, THREE.BufferGeometry>();

function buildTableTemplate(type: TableType, dimsOverride?: { w: number; d: number; h?: number }): THREE.Group {
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
  const skin = new THREE.MeshStandardMaterial({
    color: woman ? 0x8a7466 : 0x6f665c,
    roughness: 0.85,
    metalness: 0,
  });
  const hair = new THREE.MeshStandardMaterial({ color: 0x3d332a, roughness: 0.9 });
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
  const frame = new THREE.MeshStandardMaterial({ color: spec.colorHex, roughness: 0.6, metalness: 0.05 });
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
    new THREE.MeshStandardMaterial({ color: 0xf6efdf, roughness: 0.7, emissive: 0x241505, emissiveIntensity: 0.4 }),
  );
  candle.position.y = i2m(baseH + candleH / 2);
  g.add(candle);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(i2m(Math.max(0.7, w * 0.075)), 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffdf9e, emissive: 0xffa63c, emissiveIntensity: 2.4 }),
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
  const leaf = new THREE.MeshStandardMaterial({ color: 0x44543a, roughness: 0.95, flatShading: true });
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
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.75, metalness: 0.05 }),
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
  const fabric = new THREE.MeshStandardMaterial({ color: 0xf4efe3, roughness: 0.9 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5a4633, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(i2m(48), i2m(18), i2m(21)), walnut);
  base.position.y = i2m(3 + 9);
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  const casterGeo = new THREE.CylinderGeometry(i2m(1.5), i2m(1.5), i2m(1.6), 10);
  casterGeo.rotateZ(Math.PI / 2);
  const casterMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 });
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

/** One guest's rented setting: Lucca stoneware (10.75" dinner, 8" salad,
 * 6" B&B), water goblet, Nattie red-wine glass, Aspen stemless, linen napkin.
 * Glass is transparent and catches sun/candle light; plates shade softly. */
function buildSetting(): THREE.Group {
  const g = new THREE.Group();
  const stoneware = new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xf2f7fa,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const plate = (r: number, x: number, z: number, y: number, h = 0.9) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(i2m(r), i2m(r * 0.82), i2m(h), 20), stoneware);
    m.position.set(i2m(x), i2m(y + h / 2), i2m(z));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  plate(10.75 / 2, -1.5, 0, 0); // dinner
  plate(8 / 2, -1.5, 0, 0.9); // salad on top
  plate(6 / 2, -1.5, -8.2, 0, 0.7); // B&B above the dinner plate

  // menu card crowning the plate stack: ivory face inside green bridal edges
  const menuY = 1.8; // dinner + salad
  const menuGreen = new THREE.MeshStandardMaterial({ color: 0x5c7053, roughness: 0.8 });
  const menuIvory = new THREE.MeshStandardMaterial({ color: 0xfbf8ef, roughness: 0.72 });
  const menuBorder = new THREE.Mesh(new THREE.BoxGeometry(i2m(4.5), i2m(0.12), i2m(8.75)), menuGreen);
  menuBorder.position.set(i2m(-1.5), i2m(menuY + 0.06), 0);
  menuBorder.castShadow = menuBorder.receiveShadow = true;
  g.add(menuBorder);
  const menuFace = new THREE.Mesh(new THREE.BoxGeometry(i2m(4.06), i2m(0.08), i2m(8.31)), menuIvory);
  menuFace.position.set(i2m(-1.5), i2m(menuY + 0.14), 0);
  menuFace.receiveShadow = true;
  g.add(menuFace);
  const ink = new THREE.MeshStandardMaterial({ color: 0x76806b, roughness: 0.9 });
  const menuLine = (zOff: number, wIn: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(i2m(wIn), i2m(0.03), i2m(0.32)), ink);
    m.position.set(i2m(-1.5), i2m(menuY + 0.19), i2m(zOff));
    g.add(m);
  };
  menuLine(-3.1, 2.3); // MENU header
  menuLine(-1.4, 3.1);
  menuLine(-0.1, 2.7);
  menuLine(1.2, 3.1);
  menuLine(2.5, 2.4);
  const stem = (x: number, z: number, bowlR: number, bowlH: number, stemH: number) => {
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(i2m(0.22), i2m(1.2), i2m(stemH), 10), glass);
    s1.position.set(i2m(x), i2m(stemH / 2), i2m(z));
    g.add(s1);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(i2m(bowlR * 0.94), i2m(bowlR * 0.62), i2m(bowlH), 14), glass);
    bowl.position.set(i2m(x), i2m(stemH + bowlH / 2), i2m(z));
    g.add(bowl);
  };
  stem(5.4, -6.6, 1.75, 3.6, 2.6); // water goblet 12 oz
  stem(7.6, -3.4, 1.6, 4.4, 3.4); // Nattie 18 oz
  const stemless = new THREE.Mesh(new THREE.CylinderGeometry(i2m(1.55), i2m(1.15), i2m(4.4), 14), glass);
  stemless.position.set(i2m(8.3), i2m(2.2), i2m(0.6));
  g.add(stemless);
  const napkin = new THREE.Mesh(
    new THREE.BoxGeometry(i2m(3.4), i2m(0.5), i2m(8.4)),
    new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.85 }),
  );
  napkin.position.set(i2m(-8.6), i2m(0.25), i2m(0));
  napkin.castShadow = napkin.receiveShadow = true;
  g.add(napkin);
  return g;
}

// ---------------------------------------------------------------------------
// Pottery Pots planters (Diorite Grey fiberstone) + the plants that fill them
// ---------------------------------------------------------------------------

let dioriteMat: THREE.MeshStandardMaterial | null = null;
function dioriteMaterial(): THREE.MeshStandardMaterial {
  if (!dioriteMat) {
    const tex = dioriteTextures();
    dioriteMat = new THREE.MeshStandardMaterial({
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      bumpMap: tex.bumpMap,
      bumpScale: 0.012,
      roughness: 0.9,
      metalness: 0,
    });
  }
  return dioriteMat;
}

let soilMat: THREE.MeshStandardMaterial | null = null;
function soilMaterial(): THREE.MeshStandardMaterial {
  if (!soilMat) soilMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 1, metalness: 0 });
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

/** Boston fern: 22 tapered fronds arching outward on golden-angle spokes. */
function buildPlantFern(): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3e5a34, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const light = new THREE.MeshStandardMaterial({ color: 0x4e6a40, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  for (let k = 0; k < 22; k++) {
    const len = 11 + 4 * Math.abs(Math.sin(k * 2.7));
    const geo = new THREE.PlaneGeometry(i2m(1.7), i2m(len), 1, 4);
    geo.translate(0, i2m(len / 2), 0);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / i2m(len);
      pos.setX(i, pos.getX(i) * (1 - 0.75 * t * t)); // taper to the tip
      pos.setZ(i, pos.getZ(i) + i2m(4.2) * t * t); // arching droop
    }
    geo.computeVertexNormals();
    const frond = new THREE.Mesh(geo, k % 3 ? dark : light);
    frond.rotation.order = 'YXZ';
    frond.rotation.y = k * 2.39996;
    frond.rotation.x = -(0.6 + 0.45 * Math.abs(Math.sin(k * 1.3))); // lean 34–60° outward
    frond.castShadow = true;
    g.add(frond);
  }
  return g;
}

/** Boxwood ball: displaced sphere, same leaf noise as the hedge. */
function buildPlantBoxwood(): THREE.Group {
  const g = new THREE.Group();
  const leaf = new THREE.MeshStandardMaterial({ color: 0x44543a, roughness: 0.95, flatShading: true });
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
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c5232, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
  const light = new THREE.MeshStandardMaterial({ color: 0x59714a, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
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
  const green = new THREE.MeshStandardMaterial({ color: 0x6a7a4a, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const straw = new THREE.MeshStandardMaterial({ color: 0x8a9464, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
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
  const bark = new THREE.MeshStandardMaterial({ color: 0x6e6154, roughness: 0.9, flatShading: true });
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
  const leaf = new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 0.95, flatShading: true });
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
  const frondA = new THREE.MeshStandardMaterial({
    color: 0xd3e0c6,
    emissive: 0x28301f,
    emissiveIntensity: 0.35,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const frondB = new THREE.MeshStandardMaterial({
    color: 0xb8ccae,
    emissive: 0x1e2a1a,
    emissiveIntensity: 0.3,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0xe2ebd8,
    emissive: 0x2a3323,
    emissiveIntensity: 0.3,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

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
    const strand = new THREE.Mesh(geo, mossMat);
    const hangY = TOP - 12 - 14 * ((k % 4) / 3);
    strand.position.set(i2m(0.6 + r * Math.cos(a)), i2m(hangY), i2m(r * Math.sin(a)));
    strand.rotation.y = -a;
    g.add(strand);
  }
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
        .filter(
          (it) =>
            isTable(it.type) ||
            it.type === 'chair' ||
            it.type === 'hedge' ||
            it.type === 'screen' ||
            it.type === 'setting' ||
            isFigure(it.type) ||
            isLantern(it.type) ||
            isPlanter(it.type) ||
            isPlant(it.type),
        )
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
