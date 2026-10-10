import './photo.css';
import { photoMode, type PhotoStatus } from '../render/photo/photoMode';
import { getSkyInput, setSkyInput } from '../sky/skyStore';

/** Floating Photo-mode panel: progress, denoise/focus/exposure, save. */
export function buildPhotoPanel(root: HTMLElement, onBlender?: () => void): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'photo-panel';
  el.innerHTML = `
    <div class="photo-head"><span>📷 Photo</span><span class="photo-status" data-k="status"></span></div>
    <div class="photo-bar"><i data-k="bar"></i></div>
    <div class="photo-row">
      <label title="AI denoiser (Open Image Denoise)"><input type="checkbox" data-k="denoise" checked> Denoise</label>
      <label title="Depth of field — click the scene to focus"><input type="checkbox" data-k="dof"> Focus blur</label>
      <label title="Aperture (f-stop)">f/<input type="range" min="1.4" max="16" step="0.1" value="2.8" data-k="fstop"><span data-k="fval">2.8</span></label>
      <label title="Exposure compensation">EV <input type="range" min="-3" max="3" step="0.25" value="0" data-k="ev"><span data-k="evval">0</span></label>
    </div>
    <div class="photo-row">
      <button class="ui-btn primary" data-k="save" title="Save the current view as PNG">Save photo</button>
      <button class="ui-btn" data-k="save4k" title="Render and save at 3840 px">Save 4K</button>
      <button class="ui-btn" data-k="blender" title="Final-quality render in Blender Cycles">Render in Blender…</button>
      <button class="ui-btn" data-k="exit" title="Back to the editor (P or Esc)">Exit</button>
    </div>
    <div class="photo-hint" data-k="hint">Orbit, walk (V) or change the date and time — the image keeps refining. Editing returns to the planner.</div>`;
  root.appendChild(el);
  const q = <T extends HTMLElement>(k: string) => el.querySelector(`[data-k="${k}"]`) as T;
  const statusEl = q('status');
  const bar = q('bar');
  const denoiseEl = q<HTMLInputElement>('denoise');
  const dofEl = q<HTMLInputElement>('dof');
  const fstopEl = q<HTMLInputElement>('fstop');
  const fval = q('fval');
  const evEl = q<HTMLInputElement>('ev');
  const evval = q('evval');

  denoiseEl.addEventListener('change', () => photoMode.setDenoise(denoiseEl.checked));
  dofEl.addEventListener('change', () => photoMode.setDof({ enabled: dofEl.checked }));
  fstopEl.addEventListener('input', () => {
    fval.textContent = (+fstopEl.value).toFixed(1);
  });
  fstopEl.addEventListener('change', () => photoMode.setDof({ fStop: +fstopEl.value }));
  evEl.addEventListener('input', () => {
    evval.textContent = (+evEl.value > 0 ? '+' : '') + evEl.value;
  });
  evEl.addEventListener('change', () => setSkyInput({ evComp: +evEl.value }));
  q('save').addEventListener('click', () => void photoMode.savePhoto());
  q('save4k').addEventListener('click', () => void photoMode.savePhoto(3840));
  q('exit').addEventListener('click', () => photoMode.exit());
  const blenderBtn = q<HTMLButtonElement>('blender');
  if (onBlender) blenderBtn.addEventListener('click', onBlender);
  else blenderBtn.style.display = 'none';

  const fmt = (s: PhotoStatus): string => {
    switch (s.phase) {
      case 'preparing':
        return s.message ?? 'Preparing…';
      case 'rendering':
        return `${s.samples}/${s.maxSamples} samples · ${s.sps.toFixed(1)}/s`;
      case 'denoising':
        return `${s.samples} samples · denoising…`;
      case 'done':
        return `${s.samples} samples${s.denoised ? ' · denoised' : ''} · ${s.elapsedS.toFixed(0)} s`;
      case 'saving':
        return `${s.message ?? 'Saving…'} ${s.samples} samples`;
      default:
        return '';
    }
  };

  photoMode.subscribe((s) => {
    const on = s.phase !== 'off';
    el.classList.toggle('show', on);
    root.classList.toggle('photo-on', on);
    statusEl.textContent = fmt(s);
    statusEl.title = s.gpu ? `${s.gpu} (${s.tier}) · ${s.triangles.toLocaleString()} triangles · scene ${Math.round(s.setSceneMs)} ms` : '';
    const pct = s.maxSamples ? Math.min(1, s.samples / s.maxSamples) : 0;
    bar.style.width = `${Math.round((s.phase === 'done' ? 1 : pct) * 100)}%`;
    denoiseEl.disabled = s.denoiser === 'none';
    if (s.denoiser === 'none') denoiseEl.parentElement!.title = 'AI denoiser needs WebGPU (not available here)';
    if (on && s.phase === 'preparing') {
      const inp = getSkyInput();
      evEl.value = String(inp.evComp);
      evval.textContent = (inp.evComp > 0 ? '+' : '') + inp.evComp;
    }
  });
  return { el };
}
