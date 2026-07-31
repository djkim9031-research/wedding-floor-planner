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
  isFigure,
  isLantern,
  isTable,
  type LanternType,
  type TableType,
  i2m,
} from '../constants';
import { DEG, unrot } from '../core/geometry';
import type { ItemType, PlacedItem } from '../types';
import { oakTableTextures, teakTableTextures } from './textures';

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

function buildTableTemplate(type: TableType): THREE.Group {
  const { w, d } = ITEM_DIMS[type];
  const top = TABLE_TOPS[type];
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

/** Tallest tabletop under a floor point (0 = open floor) — lanterns mount on it. */
export function tableTopUnder(items: PlacedItem[], x: number, z: number): number {
  let top = 0;
  for (const it of items) {
    if (!isTable(it.type)) continue;
    const dims = ITEM_DIMS[it.type];
    const local = unrot(x - it.x, z - it.z, it.yawDeg * DEG);
    if (Math.abs(local.x) <= dims.w / 2 && Math.abs(local.z) <= dims.d / 2) {
      top = Math.max(top, TABLE_TOPS[it.type]);
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
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private plate: THREE.Mesh;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: COLORS.brass,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    this.plate.rotation.x = -Math.PI / 2;
    this.plate.position.y = i2m(0.3);
    this.plate.visible = false;
    parent.add(this.plate);
  }

  /** Everything except cloths — cloth meshes belong to the ClothManager. */
  sync(items: PlacedItem[]): void {
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
            isLantern(it.type),
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
      if (!mesh) {
        mesh = getTemplate(it.type);
        mesh.traverse((o) => {
          o.userData.itemId = id;
        });
        mesh.userData.itemId = id;
        this.parent.add(mesh);
        this.meshes.set(id, mesh);
        if (isTable(it.type)) {
          const outline = new THREE.LineSegments(
            getTableOutline(it.type),
            new THREE.LineBasicMaterial({ color: COLORS.brass, transparent: true, opacity: 0.95 }),
          );
          outline.position.y = i2m(TABLE_TOPS[it.type] - TABLE_TOP_T / 2);
          outline.visible = false;
          mesh.add(outline);
          this.outlines.set(id, outline);
        }
      }
      const mountY =
        isLantern(it.type) || it.type === 'setting' ? tableTopUnder(items, it.x, it.z) : 0;
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

  setSelected(id: string | null, items: PlacedItem[]): void {
    this.selectedId = id;
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
      if (id === this.selectedId) {
        outline.visible = true;
        mat.color.setHex(COLORS.brass);
      } else if (id === this.hoveredId) {
        outline.visible = true;
        mat.color.setHex(COLORS.hover);
      } else {
        outline.visible = false;
      }
    }
    const sel = items.find((it) => it.id === this.selectedId);
    if (sel && sel.id !== this.hiddenId) {
      const dims = ITEM_DIMS[sel.type];
      this.plate.visible = true;
      this.plate.scale.set(i2m(dims.w + 8), i2m(dims.d + 8), 1);
      this.plate.position.set(i2m(sel.x), i2m(0.3), i2m(sel.z));
      this.plate.rotation.z = sel.yawDeg * DEG;
    } else {
      this.plate.visible = false;
    }
  }

  getMesh(id: string): THREE.Group | undefined {
    return this.meshes.get(id);
  }
}
