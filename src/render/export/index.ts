import { onAppReady } from '../../app/context';
import { registerQaHook, qaReport } from '../../app/qaHooks';
import { onNativeMenu } from '../../platform/nativeMenu';
import { openBlenderDialog } from '../../ui/blenderDialog';
import { buildExportPackage, defaultSettings, packageToZip } from './exportPackage';

/** "Render in Blender": toolbar button, photo-panel/menu triggers, QA hook. */
onAppReady((ctx) => {
  const bar = ctx.root.querySelector('.topbar');
  const groups = bar?.querySelectorAll('.bar-group');
  const g = groups?.[groups.length - 1];
  if (g) {
    const b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = '🎬 Blender';
    b.title = 'Final-quality render in Blender Cycles';
    b.addEventListener('click', () => openBlenderDialog(ctx.toast));
    g.appendChild(b);
  }
  window.addEventListener('wp:render-blender', () => openBlenderDialog(ctx.toast));
  onNativeMenu('render-blender', () => openBlenderDialog(ctx.toast));
});

// QA: #export=zip → build the Blender package and expose it for the harness
registerQaHook((_ctx, params) => {
  if (params.get('export') !== 'zip') return;
  void (async () => {
    const w = Number(params.get('w') ?? '480');
    const h = Number(params.get('h') ?? '270');
    const pkg = await buildExportPackage(defaultSettings('draft', w, h, Number(params.get('samples') ?? '32')));
    const zip = packageToZip(pkg);
    let bin = '';
    for (let i = 0; i < zip.length; i += 0x8000) bin += String.fromCharCode(...zip.subarray(i, i + 0x8000));
    (window as unknown as { __wpExport?: unknown }).__wpExport = { zipBase64: btoa(bin), json: pkg.json };
    qaReport('export', { bytes: zip.length, lights: pkg.json.lights.length, checkpoints: pkg.json.checkpoints.length });
  })().catch((e) => console.error('export failed', e));
});
