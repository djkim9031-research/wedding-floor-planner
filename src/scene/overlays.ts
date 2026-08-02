import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ITEM_DIMS, ROOM_POLYGON, TABLE_TOP_MAX, WALL_NAMES, i2m } from '../constants';
import { clusterBounds, tableClusters } from '../core/clusters';
import { formatFeetInches, formatFeetInchesFull } from '../core/format';
import { obbFromPose, raycastPolygon, rot } from '../core/geometry';
import type { AppState, Vec2 } from '../types';

function makeChip(className: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0.5);
  return obj;
}

export class Overlays {
  private group: THREE.Group;
  private dimChips: CSS2DObject[] = [];
  private wallChips: CSS2DObject[] = [];
  private wallLines: THREE.LineSegments;

  constructor(parent: THREE.Group) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.wallLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4a443d, transparent: true, opacity: 0.65 }),
    );
    this.wallLines.position.y = i2m(1);
    this.wallLines.visible = false;
    this.group.add(this.wallLines);
  }

  update(state: AppState): void {
    this.updateDims(state);
    this.updateWallDistances(state);
  }

  private clearChips(list: CSS2DObject[]): void {
    for (const chip of list) this.group.remove(chip);
    list.length = 0;
  }

  private updateDims(state: AppState): void {
    this.clearChips(this.dimChips);
    if (!state.settings.showDims) return;
    const clusters = tableClusters(state.items);
    for (const cluster of clusters) {
      const b = clusterBounds(cluster);
      const chip = makeChip('chip dim-chip');
      (chip.element as HTMLElement).textContent =
        cluster.length > 1
          ? `${cluster.length} tables — ${formatFeetInchesFull(b.w)} × ${formatFeetInchesFull(b.d)}`
          : `${formatFeetInchesFull(b.w)} × ${formatFeetInchesFull(b.d)}`;
      chip.position.set(i2m(b.cx), i2m(TABLE_TOP_MAX + 8), i2m(b.cz));
      this.group.add(chip);
      this.dimChips.push(chip);
    }
  }

  updateWallDistances(state: AppState): void {
    this.clearChips(this.wallChips);
    const sel = state.items.find((it) => it.id === state.selectedId);
    if (!sel || state.ghost) {
      this.wallLines.visible = false;
      return;
    }
    const obb = obbFromPose(sel, ITEM_DIMS[sel.type]);
    const dirs: Vec2[] = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ];
    const pts: number[] = [];
    for (const dir of dirs) {
      // support point of the box in this direction
      const ax = rot(1, 0, obb.yawRad);
      const az = rot(0, 1, obb.yawRad);
      const ex = Math.abs(ax.x * dir.x + ax.z * dir.z) * obb.hw;
      const ez = Math.abs(az.x * dir.x + az.z * dir.z) * obb.hd;
      const support = ex + ez;
      const start: Vec2 = { x: obb.cx + dir.x * support, z: obb.cz + dir.z * support };
      const hit = raycastPolygon(start, dir, ROOM_POLYGON);
      if (!hit || hit.t < 1) continue;
      pts.push(start.x, start.z, hit.point.x, hit.point.z);
      // tick marks at both ends
      const tick = 4;
      const tx = -dir.z * tick;
      const tz = dir.x * tick;
      pts.push(start.x - tx, start.z - tz, start.x + tx, start.z + tz);
      pts.push(hit.point.x - tx, hit.point.z - tz, hit.point.x + tx, hit.point.z + tz);

      const chip = makeChip('chip wall-chip');
      (chip.element as HTMLElement).textContent = `${formatFeetInches(hit.t)} to ${WALL_NAMES[hit.edgeIndex]}`;
      chip.position.set(
        i2m((start.x + hit.point.x) / 2),
        i2m(4),
        i2m((start.z + hit.point.z) / 2),
      );
      this.group.add(chip);
      this.wallChips.push(chip);
    }
    const arr = new Float32Array((pts.length / 2) * 3);
    for (let i = 0; i < pts.length / 2; i++) {
      arr[i * 3] = i2m(pts[i * 2]);
      arr[i * 3 + 1] = 0;
      arr[i * 3 + 2] = i2m(pts[i * 2 + 1]);
    }
    this.wallLines.geometry.dispose();
    this.wallLines.geometry = new THREE.BufferGeometry();
    this.wallLines.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.wallLines.visible = pts.length > 0;
  }
}
