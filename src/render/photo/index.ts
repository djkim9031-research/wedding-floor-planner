import { onAppReady } from '../../app/context';
import { qaReport, registerQaHook } from '../../app/qaHooks';
import { settleCloth } from '../../app/context';
import { creatorIsOpen } from '../../creator/creatorWindow';
import { buildPhotoPanel } from '../../ui/photoPanel';
import { onNativeMenu } from '../../platform/nativeMenu';
import { photoMode } from './photoMode';

/** Photo mode feature: toolbar button, P key, panel, click-to-focus, QA hook. */
onAppReady((ctx) => {
  const bar = ctx.root.querySelector('.topbar');
  if (bar) {
    const g = document.createElement('div');
    g.className = 'bar-group';
    const b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = '📷 Photo';
    b.title = 'Photoreal path-traced view (P)';
    b.addEventListener('click', () => photoMode.toggle());
    g.appendChild(b);
    bar.appendChild(g);
    photoMode.subscribe((s) => b.classList.toggle('active', s.phase !== 'off'));
  }
  buildPhotoPanel(ctx.root, () => window.dispatchEvent(new CustomEvent('wp:render-blender')));
  onNativeMenu('export-photo', () => {
    if (photoMode.active) void photoMode.savePhoto();
    else {
      void photoMode.enter();
      ctx.toast('Photo mode — choose Save photo when the image is clean');
    }
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || creatorIsOpen()) return;
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      photoMode.toggle();
    } else if (e.key === 'Escape' && photoMode.active) {
      photoMode.exit();
    }
  });

  // click-to-focus while depth of field is on (a click, not an orbit drag)
  let down: { x: number; y: number } | null = null;
  ctx.host.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  ctx.host.canvas.addEventListener('pointerup', (e) => {
    if (!down || !photoMode.active || !photoMode.getDof()?.enabled) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = ctx.host.canvas.getBoundingClientRect();
    photoMode.focusAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  });
});

// QA: #photo=1[&spp=N][&denoise=0][&shot=1] — enter photo mode after boot,
// report when N samples are in; shot=1 then saves the photo (a download in
// the browser) and reports the PNG size in __wpPhoto.shot
registerQaHook((_ctx, params) => {
  if (params.get('photo') !== '1') return;
  const spp = Number(params.get('spp') ?? '16');
  const shot = params.get('shot') === '1';
  if (params.get('denoise') === '0') photoMode.setDenoise(false);
  void (async () => {
    await settleCloth();
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now();
    await photoMode.enter();
    let fired = false;
    const unsub = photoMode.subscribe((s) => {
      qaReport('photo', { ...s, ms: performance.now() - t0 });
      if (fired || !(s.samples >= spp || s.phase === 'done')) return;
      fired = true;
      queueMicrotask(() => unsub());
      const w = window as unknown as { __wpPhoto?: unknown };
      if (!shot) {
        w.__wpPhoto = { ...s, ms: performance.now() - t0, done: true };
        return;
      }
      void photoMode
        .savePhoto()
        .then(() => {
          w.__wpPhoto = { ...s, ms: performance.now() - t0, done: true, shot: photoMode.lastShot };
        })
        .catch((e) => {
          w.__wpPhoto = { ...s, done: true, shotError: String(e) };
        });
    });
  })();
});
