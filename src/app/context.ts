import type { ClothManager } from '../cloth';
import type { PlacementFSM } from '../interact/placementFSM';
import type { CameraRig } from '../scene/camera';
import type { ItemMeshes } from '../scene/itemMeshes';
import type { SceneHost } from '../scene/scene';
import type { SunPanel } from '../ui/sunPanel';

/** Live app services, for modules (photo mode, export, QA hooks) that need
 * more than the store. Set once by main.ts at boot. */
export interface AppContext {
  host: SceneHost;
  rig: CameraRig;
  clothMgr: ClothManager;
  itemMeshes: ItemMeshes;
  fsm: PlacementFSM;
  sunPanel: SunPanel;
  toast(msg: string): void;
  /** the toolbar's container, for modules that add their own buttons */
  root: HTMLElement;
}

let ctx: AppContext | null = null;
const ready: Array<(c: AppContext) => void> = [];

export function setAppContext(c: AppContext): void {
  ctx = c;
  for (const fn of ready.splice(0)) fn(c);
}

/** Run once the app has booted (immediately if it already has). Feature
 * modules use this to add their buttons, keys and panels. */
export function onAppReady(fn: (c: AppContext) => void): void {
  if (ctx) fn(ctx);
  else ready.push(fn);
}

export function appContext(): AppContext {
  if (!ctx) throw new Error('app context not ready');
  return ctx;
}

/** Settle every linen now (synchronously) so a snapshot sees final drapes. */
export async function settleCloth(): Promise<void> {
  const { clothMgr } = appContext();
  for (let i = 0; i < 20 && clothMgr.isActive(); i++) clothMgr.skipAll();
  // one more frame so settle callbacks (decor re-mount, seam shading) land
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
