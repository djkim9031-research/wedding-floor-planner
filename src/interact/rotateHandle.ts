import * as THREE from 'three';
import { COLORS, ITEM_DIMS, i2m } from '../constants';
import { DEG } from '../core/geometry';
import type { PlacedItem, Vec2 } from '../types';
import type { PlacementFSM } from './placementFSM';

/**
 * Flat rotation ring with a grip knob, shown around the selected item.
 * Dragging the knob rotates the item (angle-snapped unless Shift/free).
 */
export class RotateHandle {
  private group: THREE.Group;
  private ring: THREE.Mesh;
  private knob: THREE.Mesh;
  private center: Vec2 = { x: 0, z: 0 };
  private radiusIn = 40;

  constructor(parent: THREE.Group) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.012, 8, 72),
      new THREE.MeshBasicMaterial({
        color: COLORS.brass,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = i2m(1.2);
    this.group.add(this.ring);

    this.knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.brass }),
    );
    this.knob.position.y = i2m(1.2);
    this.group.add(this.knob);
  }

  show(item: PlacedItem): void {
    const dims = ITEM_DIMS[item.type];
    this.radiusIn = Math.hypot(dims.w, dims.d) / 2 + 14;
    this.center = { x: item.x, z: item.z };
    const r = i2m(this.radiusIn);
    this.ring.scale.setScalar(r);
    this.group.position.set(i2m(item.x), 0, i2m(item.z));
    this.setKnobYaw(item.yawDeg);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  setKnobYaw(yawDeg: number): void {
    const r = i2m(this.radiusIn);
    const rad = yawDeg * DEG;
    this.knob.position.set(Math.cos(rad) * r, i2m(1.2), -Math.sin(rad) * r);
  }

  /** True when the pointer is over the knob (constant ~44px screen radius). */
  hitTest(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    e: PointerEvent,
    canvas: HTMLCanvasElement,
  ): boolean {
    if (!this.group.visible) return false;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const knobWorld = new THREE.Vector3();
    this.knob.getWorldPosition(knobWorld);
    const cam = camera as THREE.PerspectiveCamera;
    const dist = knobWorld.distanceTo(cam.position);
    const worldPerPx = (2 * dist * Math.tan((cam.fov * DEG) / 2)) / Math.max(canvas.clientHeight, 1);
    return raycaster.ray.distanceToPoint(knobWorld) < Math.max(0.28, 22 * worldPerPx);
  }

  /** Convert a floor point into an absolute yaw and push it to the FSM. */
  dragTo(floor: Vec2, fsm: PlacementFSM): void {
    const dx = floor.x - this.center.x;
    const dz = floor.z - this.center.z;
    if (Math.hypot(dx, dz) < 2) return;
    const yawDeg = Math.atan2(-dz, dx) / DEG;
    fsm.setRotationYaw(yawDeg);
    this.setKnobYaw(yawDeg);
  }
}
