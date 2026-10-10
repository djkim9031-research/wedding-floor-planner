// App ▸ Settings… (Mac app): WebGPU, ANGLE backend, Blender location.
// GPU switches are Chromium command-line flags, so they apply on restart.
import { openDialog } from '../ui/dialog';
import { describeBlender, showBlenderMissing } from './blenderUi';
import { platform, type AngleBackend, type AppSettings, type BlenderDetectResult } from './bridge';

let open = false;

function row(title: string, note: string, control: HTMLElement): { el: HTMLElement; note: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'wp-dlg-row';
  const text = document.createElement('div');
  text.className = 'wp-dlg-row-text';
  text.textContent = title;
  const small = document.createElement('small');
  small.textContent = note;
  text.appendChild(small);
  el.append(text, control);
  return { el, note: small };
}

function smallBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ui-btn wp-dlg-btn';
  b.style.padding = '5px 10px';
  b.style.minHeight = '28px';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export async function openSettingsDialog(): Promise<void> {
  if (open) return;
  const p = platform();
  if (!p.native) return;
  open = true;
  try {
    const initial = await p.settings.get();
    let gpuChanged = false;

    const body = document.createElement('div');
    body.style.marginTop = '6px';

    const webgpu = document.createElement('input');
    webgpu.type = 'checkbox';
    webgpu.checked = initial.webgpu;
    const rWebgpu = row('WebGPU', 'Used by the Photo mode AI denoiser. Applies after restart.', webgpu);

    const angle = document.createElement('select');
    for (const [v, label] of [
      ['metal', 'Metal (recommended)'],
      ['gl', 'OpenGL'],
    ] as Array<[AngleBackend, string]>) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      angle.appendChild(o);
    }
    angle.value = initial.angleBackend;
    const rAngle = row('Graphics backend', 'Try OpenGL if the 3D view glitches. Applies after restart.', angle);

    const blenderCtl = document.createElement('div');
    blenderCtl.style.display = 'flex';
    blenderCtl.style.gap = '6px';
    const rBlender = row('Blender', 'Looking for Blender…', blenderCtl);
    const showBlender = (r: BlenderDetectResult): void => {
      rBlender.note.textContent = describeBlender(r) + (r.warning ? ` — ${r.warning}` : '');
      blenderCtl.innerHTML = '';
      blenderCtl.appendChild(
        smallBtn('Choose…', async () => {
          const picked = await p.blender.choose();
          if (picked) showBlender(picked);
        }),
      );
      if (!r.found) {
        blenderCtl.appendChild(
          smallBtn('Get 4.5 LTS', async () => {
            const choice = await showBlenderMissing(r);
            if (choice === 'download') void p.openExternal(r.downloadUrl);
            else if (choice === 'choose') {
              const picked = await p.blender.choose();
              if (picked) showBlender(picked);
            }
          }),
        );
      }
    };
    p.blender.detect().then(showBlender, (e) => (rBlender.note.textContent = String(e)));

    const gpuNote = document.createElement('div');
    gpuNote.className = 'wp-dlg-detail';
    gpuNote.style.marginTop = '8px';
    p.gpuInfo().then(
      (g) => {
        const fs = g.featureStatus;
        gpuNote.textContent =
          `WebGL 2: ${fs.webgl2 ?? '?'} · WebGPU: ${fs.webgpu ?? (g.webgpu ? 'on' : 'off')} · ` +
          `ANGLE: ${g.angleBackend} · Electron ${g.versions.electron ?? ''} / Chrome ${g.versions.chrome ?? ''}`;
      },
      () => undefined,
    );

    body.append(rWebgpu.el, rAngle.el, rBlender.el, gpuNote);

    const handle = openDialog<'close' | 'restart'>({
      title: 'Settings',
      body,
      width: 480,
      cancelValue: 'close',
      buttons: [
        { label: 'Restart now', value: 'restart' },
        { label: 'Done', value: 'close', primary: true },
      ],
    });
    const restartBtn = handle.buttons[0];
    restartBtn.style.display = 'none';

    const save = async (patch: Partial<AppSettings>): Promise<void> => {
      await p.settings.set(patch);
      gpuChanged = webgpu.checked !== initial.webgpu || angle.value !== initial.angleBackend;
      restartBtn.style.display = gpuChanged ? '' : 'none';
    };
    webgpu.addEventListener('change', () => void save({ webgpu: webgpu.checked }));
    angle.addEventListener('change', () => void save({ angleBackend: angle.value as AngleBackend }));

    const choice = await handle.result;
    if (choice === 'restart') await p.relaunch();
  } finally {
    open = false;
  }
}
