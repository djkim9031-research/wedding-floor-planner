import { qaReport, registerQaHook } from '../app/qaHooks';
import { lastSkyExtras } from './atmosphere';
import { getSky } from './skyStore';
import { getViewEV100 } from './viewExposure';

/** Hash hooks for sky/lighting QA:
 *   #standat=x,z,yawDeg,pitchDeg[,eyeIn]  stand camera anywhere (inches, model
 *                                         frame; yaw 0 = toward −z / the deck)
 *   #qa=sky                               report sky + exposure to __wpQA.sky */
registerQaHook((ctx, params) => {
  const st = params.get('standat');
  if (st) {
    const [x, z, yaw, pitch, eye] = st.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      ctx.rig.enterStandAt({ x, z }, yaw || 0, pitch || 0, Number.isFinite(eye) ? eye : undefined);
    }
  }
  if (params.get('qa') === 'sky') {
    const report = (): void => {
      const s = getSky();
      qaReport('sky', {
        phase: s.phase,
        sunAltDeg: +s.sun.altDeg.toFixed(2),
        sunLux: +s.sun.illuminanceLux.toFixed(1),
        sunColor: s.sun.colorLinear.map((v) => +v.toFixed(3)),
        moonLux: +s.moon.illuminanceLux.toFixed(4),
        skyHorizontalLux: +s.skyHorizontalLux.toPrecision(4),
        globalHorizontalLux: +(lastSkyExtras()?.globalHorizontalLux ?? 0).toPrecision(4),
        skyEV100: +s.ev100.toFixed(2),
        viewEV100: +(getViewEV100() ?? NaN).toFixed(2),
        computeMs: lastSkyExtras()?.timings,
      });
    };
    report();
    setInterval(report, 1000);
  }
});
