import type * as THREE from 'three';
import { ITEM_DIMS, SNAP, TABLE_TOPS, isTable, type TableType } from '../constants';
import { ClothManager } from '../cloth';
import type { ClothType } from '../cloth/constants';
import { normalizeDeg } from '../core/geometry';
import { edgeSnap } from '../core/snapping';
import { isPoseValid } from '../core/validity';
import { GhostVisual } from '../scene/ghost';
import { ItemMeshes } from '../scene/itemMeshes';
import type { GhostState, PlacedItem, Pose } from '../types';
import { STUDIO_RECT } from './studioScene';

export interface CreatorState {
  tables: PlacedItem[];
  clothType: ClothType | null;
  clothDims: { w: number; d: number } | null;
  offset: { dx: number; dz: number };
}

/** Table-group centroid (inches); origin when no tables are down. */
export function tableCentroid(tables: PlacedItem[]): { x: number; z: number } {
  if (!tables.length) return { x: 0, z: 0 };
  return {
    x: tables.reduce((a, t) => a + t.x, 0) / tables.length,
    z: tables.reduce((a, t) => a + t.z, 0) / tables.length,
  };
}

/** AABB of the table footprints (inches) — drives framing + min-cloth math. */
export function tableBBox(
  tables: PlacedItem[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (!tables.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tables) {
    const { w, d } = ITEM_DIMS[t.type];
    const yaw = (t.yawDeg * Math.PI) / 180;
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const hx = (w * c + d * s) / 2;
    const hz = (w * s + d * c) / 2;
    minX = Math.min(minX, t.x - hx);
    maxX = Math.max(maxX, t.x + hx);
    minZ = Math.min(minZ, t.z - hz);
    maxZ = Math.max(maxZ, t.z + hz);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Minimum cloth that covers the group and drapes to the floor on all sides. */
export function minClothDims(tables: PlacedItem[]): { w: number; d: number } | null {
  const b = tableBBox(tables);
  if (!b) return null;
  const h = Math.max(...tables.map((t) => TABLE_TOPS[t.type as TableType]));
  return { w: Math.ceil(b.maxX - b.minX + 2 * h), d: Math.ceil(b.maxZ - b.minZ + 2 * h) };
}

/** Sandbox placement/drape state for the Table Setup Creator. Reuses the pure
 * core math and the real cloth sim; renders through its own ItemMeshes +
 * ClothManager attached to the studio scene. */
export class CreatorController {
  readonly state: CreatorState = { tables: [], clothType: null, clothDims: null, offset: { dx: 0, dz: 0 } };
  /** armed console item (Sims-style ghost) */
  private ghostType: TableType | null = null;
  private ghostYaw = 0;
  private ghostPos: { x: number; z: number } | null = null;
  private snappedActive = false;
  private dragId: string | null = null;
  private grabOffset = { x: 0, z: 0 };
  selectedId: string | null = null;

  private readonly meshes: ItemMeshes;
  private readonly cloths: ClothManager;
  private readonly ghost: GhostVisual;
  private seq = 0;
  onChange: () => void = () => {};

  constructor(itemsGroup: THREE.Group, overlayGroup: THREE.Group) {
    this.meshes = new ItemMeshes(itemsGroup);
    this.cloths = new ClothManager(itemsGroup);
    this.ghost = new GhostVisual(overlayGroup);
  }

  /** tables + the centroid-locked cloth, in drape order (cloth last). */
  items(): PlacedItem[] {
    const out: PlacedItem[] = [...this.state.tables];
    if (this.state.clothType && this.state.tables.length) {
      const c = tableCentroid(this.state.tables);
      out.push({
        id: 'creator-cloth',
        type: this.state.clothType,
        x: c.x + this.state.offset.dx,
        z: c.z + this.state.offset.dz,
        yawDeg: 0,
        ...(this.state.clothType === 'clothC' && this.state.clothDims
          ? { dims: { ...this.state.clothDims } }
          : {}),
      });
    }
    return out;
  }

  /** design export for placeSet: poses relative to the table centroid. */
  design(): Omit<PlacedItem, 'id'>[] {
    const c = tableCentroid(this.state.tables);
    return this.items().map(({ id: _id, ...it }) => ({ ...it, x: it.x - c.x, z: it.z - c.z }));
  }

  step(dt: number): boolean {
    return this.cloths.step(dt);
  }

  sync(): void {
    const items = this.items();
    this.cloths.sync(items);
    this.meshes.sync(items);
    this.meshes.setSelected(this.selectedId ? [this.selectedId] : [], items);
    this.onChange();
  }

  // ---- console ----

  armTable(type: TableType): void {
    this.ghostType = type;
    this.ghostYaw = 0;
    this.selectedId = null;
    this.refreshGhost();
  }

  setCloth(type: ClothType | null, dims: { w: number; d: number } | null): void {
    this.state.clothType = type;
    this.state.clothDims = type === 'clothC' ? dims : null;
    this.sync();
  }

  setOffset(dx: number, dz: number): void {
    this.state.offset = { dx, dz };
    this.sync();
  }

  // ---- top-view pointer (world coords in inches) ----

  pointerMove(p: { x: number; z: number } | null): void {
    if (!p) return;
    if (this.dragId) {
      const t = this.state.tables.find((it) => it.id === this.dragId);
      if (t) {
        const pose = this.snapPose(t.type as TableType, {
          x: p.x + this.grabOffset.x,
          z: p.z + this.grabOffset.z,
          yawDeg: t.yawDeg,
        }, t.id);
        if (this.poseOk(t.type as TableType, pose, t.id)) {
          t.x = pose.x;
          t.z = pose.z;
          t.yawDeg = pose.yawDeg;
          this.sync();
        }
      }
      return;
    }
    if (this.ghostType) {
      this.ghostPos = { x: p.x, z: p.z };
      this.refreshGhost();
    }
  }

  pointerDown(p: { x: number; z: number } | null, hitId: string | null): void {
    if (this.ghostType) return; // handled on click/up
    if (hitId && hitId !== 'creator-cloth') {
      this.selectedId = hitId;
      const t = this.state.tables.find((it) => it.id === hitId);
      if (t && p) this.grabOffset = { x: t.x - p.x, z: t.z - p.z };
      this.dragId = hitId;
      this.sync();
    } else {
      this.selectedId = null;
      this.sync();
    }
  }

  pointerUp(): void {
    this.dragId = null;
  }

  click(p: { x: number; z: number } | null): void {
    if (!this.ghostType || !p) return;
    const pose = this.snapPose(this.ghostType, { x: p.x, z: p.z, yawDeg: this.ghostYaw });
    if (!this.poseOk(this.ghostType, pose)) return;
    this.state.tables.push({ id: `ct${++this.seq}`, type: this.ghostType, ...pose });
    this.refreshGhost(); // stay armed, Sims-style
    this.sync();
  }

  rotate(deg: number): void {
    if (this.ghostType) {
      this.ghostYaw = normalizeDeg(this.ghostYaw + deg);
      this.refreshGhost();
      return;
    }
    const t = this.state.tables.find((it) => it.id === this.selectedId);
    if (!t) return;
    const pose = { x: t.x, z: t.z, yawDeg: normalizeDeg(t.yawDeg + deg) };
    if (this.poseOk(t.type as TableType, pose, t.id)) {
      t.yawDeg = pose.yawDeg;
      this.sync();
    }
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.state.tables = this.state.tables.filter((it) => it.id !== this.selectedId);
    this.selectedId = null;
    this.sync();
  }

  cancelGhost(): void {
    this.ghostType = null;
    this.ghost.update(null, this.items());
  }

  hasGhost(): boolean {
    return this.ghostType !== null;
  }

  /** 2D pick in the top view (inches). */
  pickAt(p: { x: number; z: number }): string | null {
    for (let i = this.state.tables.length - 1; i >= 0; i--) {
      const t = this.state.tables[i];
      const { w, d } = ITEM_DIMS[t.type];
      const yaw = (-t.yawDeg * Math.PI) / 180;
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2) return t.id;
    }
    return null;
  }

  drapeReport() {
    return this.cloths.getReport('creator-cloth');
  }

  dispose(): void {
    this.cloths.dispose();
  }

  // ---- internals ----

  private snapPose(type: TableType, pose: Pose, selfId?: string): Pose {
    const snapped = edgeSnap(
      type,
      pose,
      this.state.tables,
      selfId,
      this.snappedActive ? SNAP.release : SNAP.engage,
    );
    this.snappedActive = !!snapped;
    return snapped ? snapped.pose : pose;
  }

  private poseOk(type: TableType, pose: Pose, selfId?: string): boolean {
    return isPoseValid(type, pose, this.state.tables, selfId, [STUDIO_RECT]);
  }

  private refreshGhost(): void {
    if (!this.ghostType || !this.ghostPos) {
      this.ghost.update(null, this.items());
      return;
    }
    const pose = this.snapPose(this.ghostType, {
      x: this.ghostPos.x,
      z: this.ghostPos.z,
      yawDeg: this.ghostYaw,
    });
    const g: GhostState = {
      type: this.ghostType,
      ...pose,
      valid: this.poseOk(this.ghostType, pose),
      snapped: null,
    };
    this.ghost.update(g, this.items());
  }
}

/** Cloth type helper for labels. */
export const isCreatorTable = (t: string): t is TableType => isTable(t as TableType);
