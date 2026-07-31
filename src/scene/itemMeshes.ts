import * as THREE from 'three';
import {
  COLORS,
  FIGURE_HEIGHT,
  ITEM_DIMS,
  LEG_SIZE,
  TABLE_TOPS,
  TABLE_TOP_T,
  isTable,
  type TableType,
  i2m,
} from '../constants';
import { DEG } from '../core/geometry';
import type { PlacedItem } from '../types';
import { oakTableTextures, teakTableTextures } from './textures';

const woodMaterials = new Map<string, THREE.MeshStandardMaterial>();

function tableMaterial(type: TableType): THREE.MeshStandardMaterial {
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

const tableTemplates = new Map<TableType, THREE.Group>();
const tableOutlines = new Map<TableType, THREE.BufferGeometry>();

function buildTableTemplate(type: TableType): THREE.Group {
  let template = tableTemplates.get(type);
  if (!template) {
    const { w, d } = ITEM_DIMS[type];
    const top = TABLE_TOPS[type];
    const wood = tableMaterial(type);
    template = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(TABLE_TOP_T), i2m(d)), wood);
    slab.position.y = i2m(top - TABLE_TOP_T / 2);
    slab.castShadow = slab.receiveShadow = true;
    template.add(slab);
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
      template.add(leg);
    }
    tableTemplates.set(type, template);
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

function buildFigure(): THREE.Group {
  // Flat 5'6" silhouette standee: head + shoulders/body outline.
  const s = new THREE.Shape();
  const W = i2m(ITEM_DIMS.figure.w);
  const H = i2m(FIGURE_HEIGHT);
  const hw = W / 2;
  s.moveTo(-hw * 0.55, 0);
  s.lineTo(-hw * 0.62, H * 0.52);
  s.quadraticCurveTo(-hw, H * 0.62, -hw * 0.7, H * 0.76);
  s.quadraticCurveTo(-hw * 0.36, H * 0.84, -hw * 0.2, H * 0.84);
  s.absarc(0, H * 0.915, H * 0.085, Math.PI * 1.15, Math.PI * -0.15, false);
  s.lineTo(hw * 0.2, H * 0.84);
  s.quadraticCurveTo(hw * 0.36, H * 0.84, hw * 0.7, H * 0.76);
  s.quadraticCurveTo(hw, H * 0.62, hw * 0.62, H * 0.52);
  s.lineTo(hw * 0.55, 0);
  s.closePath();
  const geom = new THREE.ExtrudeGeometry(s, { depth: i2m(1.5), bevelEnabled: false });
  geom.translate(0, 0, -i2m(0.75));
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.ownsResources = true; // per-instance geometry/material
  return g;
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

  /** Tables and figures only — cloth meshes belong to the ClothManager. */
  sync(items: PlacedItem[]): void {
    const wanted = new Map(
      items.filter((it) => isTable(it.type) || it.type === 'figure').map((it) => [it.id, it]),
    );
    for (const [id, mesh] of this.meshes) {
      if (!wanted.has(id)) {
        this.parent.remove(mesh);
        this.meshes.delete(id);
        if (mesh.userData.ownsResources) {
          mesh.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.geometry.dispose();
              (o.material as THREE.Material).dispose();
            }
          });
        }
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
        mesh = isTable(it.type) ? buildTableTemplate(it.type) : buildFigure();
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
