import type { ClothManager } from '../cloth';
import type { SceneHost } from '../scene/scene';
import type { SkyState } from '../sky/types';
import type { RenderSceneOptions, RenderSceneResult } from './types';

/** Placeholder until the render-scene builder lands (same signature). */
export function buildRenderScene(
  _host: SceneHost,
  _clothMgr: ClothManager,
  _opts: RenderSceneOptions & { sky: SkyState },
): RenderSceneResult {
  throw new Error('render-scene builder not available yet');
}
