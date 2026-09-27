import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { appContext, settleCloth } from '../../app/context';
import { itemDims, itemTop } from '../../constants';
import { getSky } from '../../sky/skyStore';
import * as store from '../../state/store';
import { buildRenderScene } from '../renderScene';
import { buildSceneJson, checkpoints, type RenderSettings, type WpSceneJson } from './sceneJson';
import { skyToExr } from './skyExr';
// the render script ships inside the web zip (the Mac app bundles its own copy)
import renderScript from '../../../blender/render_venue.py?raw';

export interface ExportPackage {
  files: Record<string, Uint8Array | string>;
  json: WpSceneJson;
}

export const APP_VERSION = '2.0.0';

/** Snapshot the current view for Blender: settled drapes, render-only scene
 * as binary glTF, the physical sky as EXR and the job description. */
export async function buildExportPackage(settings: RenderSettings): Promise<ExportPackage> {
  const ctx = appContext();
  await settleCloth();
  const camera = ctx.host.getCamera();
  if (!camera) throw new Error('no camera');
  const sky = getSky();
  const inside = camera.position.y < 4.5;
  const built = buildRenderScene(ctx.host, ctx.clothMgr, { target: 'gltf', includeRoof: ctx.host.roofVisible() || inside, sky });
  try {
    const glb = (await new GLTFExporter().parseAsync(built.scene, {
      binary: true,
      onlyVisible: false,
      maxTextureSize: 2048,
      includeCustomExtensions: false,
    })) as ArrayBuffer;
    const exr = await skyToExr(sky.env);
    const items = store
      .getState()
      .items.filter((it) => !it.type.startsWith('cloth'))
      .map((it) => ({ x: it.x, z: it.z, topIn: Math.max(itemTop(it), 1), w: itemDims(it).w }));
    const json = buildSceneJson({
      sky,
      camera,
      settings,
      lights: built.lights,
      roles: built.roles,
      checkpoints: checkpoints(camera, settings.w, settings.h, items),
      stats: { ...built.stats },
      appVersion: APP_VERSION,
    });
    return {
      json,
      files: {
        'scene.glb': new Uint8Array(glb),
        'sky.exr': exr,
        'scene.json': JSON.stringify(json, null, 1),
      },
    };
  } finally {
    built.dispose();
  }
}

const README = `Wedding Venue Studio — Blender render package

1. Install Blender 4.5 LTS (https://www.blender.org/download/lts/4-5/).
2. In a terminal, from this folder:
     macOS:   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P render_venue.py -- --job .
     Windows: "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe" -b --factory-startup -P render_venue.py -- --job .
   (or run ./render.sh on macOS/Linux)
3. The image is written to render.png and the editable scene to scene.blend.
Options: --preset draft|standard|final   --res 1920x1080   --samples 256
`;

const RENDER_SH = `#!/bin/sh
# Render this package with Blender 4.5 LTS
cd "$(dirname "$0")"
B="\${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
[ -x "$B" ] || B="$(command -v blender)"
exec "$B" -b --factory-startup --python-exit-code 1 -P render_venue.py -- --job . "$@"
`;

/** The same package as a zip, runnable by hand with any Blender 4.5. */
export function packageToZip(pkg: ExportPackage): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [k, v] of Object.entries(pkg.files)) files[k] = typeof v === 'string' ? strToU8(v) : [v, { level: 0 }];
  files['render_venue.py'] = strToU8(renderScript);
  files['README.txt'] = strToU8(README);
  files['render.sh'] = strToU8(RENDER_SH);
  return zipSync(files as Parameters<typeof zipSync>[0], { level: 6 });
}

export function defaultSettings(preset: RenderSettings['preset'], w: number, h: number, samples: number): RenderSettings {
  return { preset, w, h, samples, panorama: false, saveBlend: true, dof: { enabled: false, focusM: 5, fStop: 2.8 } };
}
