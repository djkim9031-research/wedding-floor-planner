import * as THREE from 'three';
import {
  CHAIR_BACK_H,
  CHAIR_SEAT_H,
  COLORS,
  FIGURE_HEIGHTS,
  ITEM_DIMS,
  LEG_SIZE,
  TABLE_TOPS,
  TABLE_TOP_T,
  isFigure,
  isTable,
  type TableType,
  i2m,
} from '../constants';
import { DEG } from '../core/geometry';
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
  const seatD = 17.5;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(i2m(seatW), i2m(1.8), i2m(seatD)), wood);
  seat.position.set(0, i2m(CHAIR_SEAT_H - 0.9), i2m(0.75));
  seat.castShadow = seat.receiveShadow = true;
  g.add(seat);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(i2m(seatW - 1), i2m(CHAIR_BACK_H - CHAIR_SEAT_H), i2m(1.5)),
    wood,
  );
  back.position.set(0, i2m((CHAIR_BACK_H + CHAIR_SEAT_H) / 2), i2m(-(seatD / 2) + 0.4));
  back.rotation.x = -0.09;
  back.castShadow = true;
  g.add(back);

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

function getTemplate(type: ItemType): THREE.Group {
  let template = templates.get(type);
  if (!template) {
    if (isTable(type)) template = buildTableTemplate(type);
    else if (type === 'chair') template = buildChair();
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
        .filter((it) => isTable(it.type) || it.type === 'chair' || isFigure(it.type))
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
      mesh.position.set(i2m(it.x), 0, i2m(it.z));
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
