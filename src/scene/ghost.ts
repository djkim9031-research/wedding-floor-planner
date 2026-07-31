import * as THREE from 'three';
import {
  CHAIR_BACK_H,
  CHAIR_SEAT_H,
  COLORS,
  FIGURE_HEIGHTS,
  ITEM_DIMS,
  LEG_SIZE,
  TABLE_TOPS,
  TABLE_TOP_MAX,
  TABLE_TOP_T,
  isFigure,
  isTable,
  i2m,
} from '../constants';
import { DEG } from '../core/geometry';
import type { GhostState, ItemType, PlacedItem } from '../types';

function disposeGhostMesh(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

function ghostMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS.valid,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    roughness: 0.7,
  });
}

function buildGhostMesh(type: ItemType): THREE.Group {
  const g = new THREE.Group();
  const mat = ghostMaterial();
  const { w, d } = ITEM_DIMS[type];
  if (isTable(type)) {
    const topY = TABLE_TOPS[type];
    const top = new THREE.Mesh(new THREE.BoxGeometry(i2m(w), i2m(TABLE_TOP_T), i2m(d)), mat);
    top.position.y = i2m(topY - TABLE_TOP_T / 2);
    g.add(top);
    const legGeom = new THREE.BoxGeometry(i2m(LEG_SIZE), i2m(topY), i2m(LEG_SIZE));
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]) {
      const leg = new THREE.Mesh(legGeom, mat);
      leg.position.set(
        i2m(sx * (w / 2 - LEG_SIZE / 2)),
        i2m(topY / 2),
        i2m(sz * (d / 2 - LEG_SIZE / 2)),
      );
      g.add(leg);
    }
  } else if (type === 'chair') {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(i2m(19), i2m(1.8), i2m(17.5)), mat);
    seat.position.set(0, i2m(CHAIR_SEAT_H - 0.9), i2m(0.75));
    g.add(seat);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(i2m(18), i2m(CHAIR_BACK_H - CHAIR_SEAT_H), i2m(1.5)),
      mat,
    );
    back.position.set(0, i2m((CHAIR_BACK_H + CHAIR_SEAT_H) / 2), i2m(-7.85));
    g.add(back);
  } else if (isFigure(type)) {
    const h = FIGURE_HEIGHTS[type as 'figureW' | 'figureM'];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(i2m(w / 2), i2m(h - w), 4, 10), mat);
    body.position.y = i2m(h / 2);
    g.add(body);
  } else {
    // cloth: a floating translucent sheet at drop height
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(i2m(w), i2m(d)), mat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.userData.isSheet = true;
    g.add(sheet);
  }
  g.userData.ghostType = type;
  return g;
}

export class GhostVisual {
  private parent: THREE.Group;
  private mesh: THREE.Group | null = null;
  private plate: THREE.Mesh;
  private plateEdge: THREE.LineLoop;
  private snapLine: THREE.Line;

  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: COLORS.valid,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.plate.rotation.x = -Math.PI / 2;
    this.plate.position.y = i2m(0.4);
    this.plate.visible = false;
    parent.add(this.plate);

    const edgeGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ]);
    this.plateEdge = new THREE.LineLoop(
      edgeGeom,
      new THREE.LineBasicMaterial({ color: COLORS.valid, transparent: true, opacity: 0.9 }),
    );
    this.plateEdge.position.y = i2m(0.5);
    this.plateEdge.visible = false;
    parent.add(this.plateEdge);

    this.snapLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: COLORS.brass, linewidth: 2 }),
    );
    this.snapLine.position.y = i2m(37);
    this.snapLine.visible = false;
    parent.add(this.snapLine);
  }

  update(ghost: GhostState | null, items: PlacedItem[]): void {
    if (!ghost) {
      if (this.mesh) {
        this.parent.remove(this.mesh);
        disposeGhostMesh(this.mesh);
        this.mesh = null;
      }
      this.plate.visible = false;
      this.plateEdge.visible = false;
      this.snapLine.visible = false;
      return;
    }

    if (!this.mesh || this.mesh.userData.ghostType !== ghost.type) {
      if (this.mesh) {
        this.parent.remove(this.mesh);
        disposeGhostMesh(this.mesh);
      }
      this.mesh = buildGhostMesh(ghost.type);
      this.parent.add(this.mesh);
    }
    const { w, d } = ITEM_DIMS[ghost.type];
    this.mesh.position.set(i2m(ghost.x), 0, i2m(ghost.z));
    this.mesh.rotation.y = ghost.yawDeg * DEG;

    const color = ghost.valid ? COLORS.valid : COLORS.invalid;
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        (o.material as THREE.MeshStandardMaterial).color.setHex(color);
        if (o.userData.isSheet) {
          // hover the sheet above tables when it would drape over any
          const overTable = items.some(
            (it) =>
              isTable(it.type) &&
              Math.abs(it.x - ghost.x) < (w + ITEM_DIMS[it.type].w) / 2 &&
              Math.abs(it.z - ghost.z) < (d + ITEM_DIMS[it.type].d) / 2,
          );
          o.position.y = i2m(overTable ? TABLE_TOP_MAX + 2 : 2);
        }
      }
    });

    this.plate.visible = true;
    this.plate.scale.set(i2m(w + 6), i2m(d + 6), 1);
    this.plate.position.set(i2m(ghost.x), i2m(0.4), i2m(ghost.z));
    this.plate.rotation.z = ghost.yawDeg * DEG;
    (this.plate.material as THREE.MeshBasicMaterial).color.setHex(color);

    this.plateEdge.visible = true;
    this.plateEdge.scale.set(i2m(w + 6), 1, i2m(d + 6));
    this.plateEdge.position.set(i2m(ghost.x), i2m(0.5), i2m(ghost.z));
    this.plateEdge.rotation.y = ghost.yawDeg * DEG;
    (this.plateEdge.material as THREE.LineBasicMaterial).color.setHex(color);

    if (ghost.snapped) {
      const [a, b] = ghost.snapped.sharedEdge;
      const pos = this.snapLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, i2m(a.x), 0, i2m(a.z));
      pos.setXYZ(1, i2m(b.x), 0, i2m(b.z));
      pos.needsUpdate = true;
      this.snapLine.geometry.computeBoundingSphere();
      this.snapLine.visible = true;
    } else {
      this.snapLine.visible = false;
    }
  }
}
