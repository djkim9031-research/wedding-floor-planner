import { qaReport, registerQaHook } from '../app/qaHooks';
import { lastSkyExtras, lutBuildMs } from './atmosphere';
import { getSky, getSkyInput, setSkyInput } from './skyStore';
import { getViewEV100 } from './viewExposure';

/** Hash hooks for sky/lighting QA:
 *   #standat=x,z,yawDeg,pitchDeg[,eyeIn]  stand camera anywhere (inches, model
 *                                         frame; yaw 0 = toward −z / the deck)
 *   #qa=sky                               report sky + exposure to __wpQA.sky
 *   #qa=skybench                          time 24 slider steps (compute + GPU
 *                                         apply) → __wpQA.skybench */
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
        lutBuildMs: +lutBuildMs().toFixed(1),
        applyMs: (window as unknown as { __wpSkyApplyMs?: number }).__wpSkyApplyMs,
        exposure: (window as unknown as { __wpExposure?: object }).__wpExposure,
      });
    };
    report();
    setInterval(report, 1000);
  }
  if (params.get('qa') === 'skybench') {
    setTimeout(() => {
      const saved = { ...getSkyInput() };
      const total: number[] = [];
      const compute: number[] = [];
      const apply: number[] = [];
      for (let i = 0; i < 24; i++) {
        const t0 = performance.now();
        setSkyInput({ enabled: true, minutes: 18 * 60 + 20 + i * 5 }); // dusk sweep
        total.push(performance.now() - t0);
        compute.push(lastSkyExtras()?.timings.total ?? NaN);
        apply.push((window as unknown as { __wpSkyApplyMs?: number }).__wpSkyApplyMs ?? NaN);
      }
      setSkyInput(saved);
      const med = (a: number[]) => +[...a].sort((x, y) => x - y)[a.length >> 1].toFixed(1);
      qaReport('skybench', { steps: 24, medianTotalMs: med(total), medianComputeMs: med(compute), medianApplyMs: med(apply), minTotalMs: +Math.min(...total).toFixed(1) });
    }, 1500);
  }
});
