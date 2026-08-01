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

export type CreatorItemType = TableType | 'chair' | 'setting';

export interface CreatorCloth {
  id: string;
  type: ClothType;
  dims?: { w: number; d: number };
  /** offset of this cloth's centroid from the table-group centroid */
  offset: { dx: number; dz: number };
}

export interface CreatorState {
  tables: PlacedItem[];
  /** chairs + settings — placed AFTER the cloths so no linen drapes over
   * them and settings ride the settled fabric */
  extras: PlacedItem[];
  cloths: CreatorCloth[];
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
    const { w, d } = t.dims ?? ITEM_DIMS[t.type];
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
  const h = Math.max(...tables.map((t) => t.dims?.h ?? TABLE_TOPS[t.type as TableType]));
  return { w: Math.ceil(b.maxX - b.minX + 2 * h), d: Math.ceil(b.maxZ - b.minZ + 2 * h) };
}

/** Sandbox placement/drape state for the Table Setup Creator. Reuses the pure
 * core math and the real cloth sim; renders through its own ItemMeshes +
 * ClothManager attached to the studio scene. */
export class CreatorController {
  readonly state: CreatorState = { tables: [], extras: [], cloths: [] };
  /** the cloth the offset/hem controls currently drive */
  activeClothId: string | null = null;
  /** armed console item (Sims-style ghost) */
  private ghostType: CreatorItemType | null = null;
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
    // settings dropped after the linen ride its settled surface
    this.cloths.onSettled(() => {
      const items = this.items();
      this.meshes.sync(items, (it) => this.cloths.mountLift(it, items));
      this.onChange();
    });
  }

  private all(): PlacedItem[] {
    return [...this.state.tables, ...this.state.extras];
  }

  private findItem(id: string): PlacedItem | undefined {
    return this.all().find((it) => it.id === id);
  }

  /** tables, then every centroid-locked cloth, then chairs/settings — the
   * order IS the stacking: linens drape the tables only, and later settings
   * sit on the fabric. */
  items(): PlacedItem[] {
    const out: PlacedItem[] = [...this.state.tables];
    if (this.state.tables.length) {
      const c = tableCentroid(this.state.tables);
      for (const cl of this.state.cloths) {
        out.push({
          id: cl.id,
          type: cl.type,
          x: c.x + cl.offset.dx,
          z: c.z + cl.offset.dz,
          yawDeg: 0,
          ...(cl.dims ? { dims: { ...cl.dims } } : {}),
        });
      }
    }
    out.push(...this.state.extras);
    return out;
  }

  /** Seed the sandbox from an existing set (centroid-relative poses). */
  loadInitial(init: { tables: PlacedItem[]; cloths: CreatorCloth[]; extras: PlacedItem[] }): void {
    this.state.tables = init.tables.map((t) => ({ ...t }));
    this.state.extras = init.extras.map((t) => ({ ...t }));
    this.state.cloths = init.cloths.map((c) => ({ ...c, offset: { ...c.offset } }));
    this.seq = 1000; // fresh ids never collide with loaded ones
    const last = this.state.cloths[this.state.cloths.length - 1];
    this.activeClothId = last ? last.id : null;
  }

  activeCloth(): CreatorCloth | null {
    return this.state.cloths.find((c) => c.id === this.activeClothId) ?? null;
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
    this.meshes.sync(items, (it) => this.cloths.mountLift(it, items));
    this.meshes.setSelected(this.selectedId ? [this.selectedId] : [], items);
    this.onChange();
  }

  // ---- console ----

  armTable(type: CreatorItemType): void {
    this.ghostType = type;
    this.ghostYaw = 0;
    this.selectedId = null;
    this.refreshGhost();
  }

  addCloth(type: ClothType, dims: { w: number; d: number } | null): string {
    const id = `cc${++this.seq}`;
    this.state.cloths.push({
      id,
      type,
      ...(type === 'clothC' && dims ? { dims: { ...dims } } : {}),
      offset: { dx: 0, dz: 0 },
    });
    this.activeClothId = id;
    this.selectedId = null;
    this.sync();
    return id;
  }

  removeItem(id: string): void {
    this.state.tables = this.state.tables.filter((it) => it.id !== id);
    this.state.extras = this.state.extras.filter((it) => it.id !== id);
    this.state.cloths = this.state.cloths.filter((it) => it.id !== id);
    if (this.activeClothId === id) {
      const rest = this.state.cloths;
      this.activeClothId = rest.length ? rest[rest.length - 1].id : null;
    }
    if (this.selectedId === id) this.selectedId = null;
    this.sync();
  }

  /** row click: cloths bind the offset/hem controls, solids arm for dragging */
  selectItem(id: string): void {
    if (this.state.cloths.some((c) => c.id === id)) {
      this.activeClothId = id;
      this.selectedId = null;
    } else {
      this.selectedId = id;
    }
    this.sync();
  }

  /** offset applies to the active cloth */
  setOffset(dx: number, dz: number): void {
    const c = this.activeCloth();
    if (!c) return;
    c.offset = { dx, dz };
    this.sync();
  }

  // ---- top-view pointer (world coords in inches) ----

  pointerMove(p: { x: number; z: number } | null): void {
    if (!p) return;
    if (this.dragId) {
      const t = this.findItem(this.dragId);
      if (t) {
        const pose = this.snapPose(t.type as CreatorItemType, {
          x: p.x + this.grabOffset.x,
          z: p.z + this.grabOffset.z,
          yawDeg: t.yawDeg,
        }, t.id);
        if (this.poseOk(t.type as CreatorItemType, pose, t.id)) {
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
    if (hitId) {
      this.selectedId = hitId;
      const t = this.findItem(hitId);
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
    const item: PlacedItem = { id: `ct${++this.seq}`, type: this.ghostType, ...pose };
    if (this.ghostType === 'tableC') item.dims = { ...ITEM_DIMS.tableC, h: TABLE_TOPS.tableC };
    if (isTable(this.ghostType)) this.state.tables.push(item);
    else this.state.extras.push(item);
    this.refreshGhost(); // stay armed, Sims-style
    this.sync();
  }

  rotate(deg: number): void {
    if (this.ghostType) {
      this.ghostYaw = normalizeDeg(this.ghostYaw + deg);
      this.refreshGhost();
      return;
    }
    const t = this.findItem(this.selectedId ?? '');
    if (!t) return;
    const pose = { x: t.x, z: t.z, yawDeg: normalizeDeg(t.yawDeg + deg) };
    if (this.poseOk(t.type as CreatorItemType, pose, t.id)) {
      t.yawDeg = pose.yawDeg;
      this.sync();
    }
  }

  /** keyboard nudge of the selected solid (inches, world axes) */
  nudgeSelected(dx: number, dz: number): void {
    const t = this.findItem(this.selectedId ?? '');
    if (!t) return;
    const pose = { x: t.x + dx, z: t.z + dz, yawDeg: t.yawDeg };
    if (this.poseOk(t.type as CreatorItemType, pose, t.id)) {
      t.x = pose.x;
      t.z = pose.z;
      this.sync();
    }
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.removeItem(this.selectedId);
  }

  cancelGhost(): void {
    this.ghostType = null;
    this.ghost.update(null, this.items());
  }

  hasGhost(): boolean {
    return this.ghostType !== null;
  }

  /** 2D pick in the top view (inches): extras above tables; cloths are
   * selected from the placed list, not the canvas. */
  pickAt(p: { x: number; z: number }): string | null {
    const all = [...this.state.tables, ...this.state.extras];
    for (let i = all.length - 1; i >= 0; i--) {
      const t = all[i];
      const { w, d } = t.dims ?? ITEM_DIMS[t.type];
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
    return this.activeClothId ? this.cloths.getReport(this.activeClothId) : null;
  }

  dispose(): void {
    this.cloths.dispose();
  }

  // ---- internals ----

  private snapPose(type: CreatorItemType, pose: Pose, selfId?: string): Pose {
    if (!isTable(type)) return pose; // magnet snapping is a table behavior
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

  private poseOk(type: CreatorItemType, pose: Pose, selfId?: string): boolean {
    return isPoseValid(type, pose, this.all(), selfId, [STUDIO_RECT]);
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
