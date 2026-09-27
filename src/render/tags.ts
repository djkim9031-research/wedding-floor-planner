import type * as THREE from 'three';
import type { MaterialRole, ObjectRenderTag, PbrTag } from './types';

let seq = 0;

/** Attach a physical role to a material (and name it "<role>__<id>").
 * Returns the material so creation sites can wrap `new ...Material()`. */
export function tag<T extends THREE.Material>(mat: T, role: MaterialRole, extra: Omit<PbrTag, 'role'> = {}, id?: string): T {
  mat.userData.pbr = { role, ...extra } satisfies PbrTag;
  mat.name = `${role}__${id ?? `m${++seq}`}`;
  return mat;
}

export function pbrOf(mat: THREE.Material): PbrTag | undefined {
  return mat.userData.pbr as PbrTag | undefined;
}

/** Mark an object as never renderable (helpers, overlays, debug). */
export function excludeFromRender<T extends THREE.Object3D>(obj: T): T {
  obj.userData.render = { ...(obj.userData.render as ObjectRenderTag | undefined), exclude: true };
  return obj;
}

export function renderTagOf(obj: THREE.Object3D): ObjectRenderTag | undefined {
  return obj.userData.render as ObjectRenderTag | undefined;
}
