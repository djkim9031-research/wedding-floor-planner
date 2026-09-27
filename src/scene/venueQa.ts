import type * as THREE from 'three';
import { qaReport, registerQaHook } from '../app/qaHooks';
import { allFixtures } from './fixtures';
import { triCount } from './venue/geom';

// QA hooks for the hall-realism pass:
//   #ref=2 | #ref=5  stand at the viewpoint of reference photo 02 (toward the
//                    south entry) / 05 (toward the north window wall + deck),
//                    iPhone-matched vertical FOV, UI hidden, roof shown.
//   #qa=venue        report venue triangle counts + interior fixtures.
// Viewpoints were fitted from the photos' vanishing points against the plan
// (window-wall posts, entry module edges, rails at 36"); eye ≈ 52".

interface RefView {
  at: { x: number; z: number };
  yawDeg: number;
  pitchDeg: number;
  eyeIn: number;
}

export const REF_VIEWS: Record<string, RefView> = {
  '2': { at: { x: 234, z: 214 }, yawDeg: 190.4, pitchDeg: 2.2, eyeIn: 52 },
  '5': { at: { x: 100, z: 582 }, yawDeg: -22, pitchDeg: 1.45, eyeIn: 52 },
  // approximate (not fitted): under the covered deck bay looking NE past the
  // stucco pier and the sage post / beam end, as in photo 03
  '3': { at: { x: -100, z: -8 }, yawDeg: -58, pitchDeg: 9, eyeIn: 58 },
};

/** Vertical FOV of the reference photos (iPhone main camera, 4:3). */
export const REF_FOV_Y = 53.1;

function hideUi(): void {
  const st = document.createElement('style');
  st.textContent = '.viewport > *:not(canvas) { display: none !important; } #boot-error { display: none !important; }';
  document.head.appendChild(st);
}

registerQaHook((ctx, params) => {
  const ref = params.get('ref');
  const view = ref ? REF_VIEWS[ref] : undefined;
  if (view) {
    hideUi();
    ctx.host.setOverlaysVisible(false);
    const cam = ctx.rig.camera as THREE.PerspectiveCamera;
    cam.fov = REF_FOV_Y;
    cam.updateProjectionMatrix();
    ctx.rig.enterStandAt(view.at, view.yawDeg, view.pitchDeg, view.eyeIn);
    ctx.host.setRoofVisible(true);
    ctx.host.invalidate();
  }
  if (params.get('qa') === 'venue') {
    // timing aid for headless checks: one synchronous raster frame, in ms
    (window as unknown as { __venueHost?: unknown }).__venueHost = ctx.host;
    (window as unknown as { __venueFrameMs?: () => number }).__venueFrameMs = () => {
      const cam = ctx.host.getCamera();
      if (!cam) return -1;
      const gl = ctx.host.renderer.getContext();
      const px = new Uint8Array(4);
      const t0 = performance.now();
      ctx.host.rasterize(cam, { overlays: false });
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return performance.now() - t0;
    };
    const venue = ctx.host.venueGroup;
    const roof = ctx.host.roof;
    const all = triCount(venue);
    const roofTris = triCount(roof);
    let renderOnly = 0;
    venue.traverse((o) => {
      if ((o.userData.render as { lod?: string } | undefined)?.lod === 'render') renderOnly += triCount(o);
    });
    const fx = allFixtures().filter((f) => f.group === 'interior');
    qaReport('venue', {
      trianglesTotal: all,
      trianglesRoof: roofTris,
      trianglesWalls: all - roofTris,
      trianglesRenderOnly: renderOnly,
      interiorFixtures: fx.length,
      fixtureSample: fx[0] ?? null,
    });
  }
});
