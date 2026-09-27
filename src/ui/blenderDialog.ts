import './blender.css';
import { buildExportPackage, packageToZip } from '../render/export/exportPackage';
import { BLENDER_PRESETS, type RenderSettings } from '../render/export/sceneJson';
import { photoMode } from '../render/photo/photoMode';
import { saveBlob } from '../render/photo/save';
import { getSky } from '../sky/skyStore';
import { platform, type BlenderDetectResult, type BlenderEvent } from '../platform/bridge';

let open = false;

export function openBlenderDialog(toast: (m: string) => void): void {
  if (open) return;
  open = true;
  const p = platform();
  const bl = p.native ? p.blender : null;
  const back = document.createElement('div');
  back.className = 'bl-backdrop';
  const dlg = document.createElement('div');
  dlg.className = 'bl-dialog';
  back.appendChild(dlg);
  document.body.appendChild(back);
  const close = () => {
    open = false;
    unsub?.();
    back.remove();
  };
  let unsub: (() => void) | null = null;
  let jobId: string | null = null;

  const sky = getSky();
  const dof = photoMode.getDof();
  dlg.innerHTML = `
    <h3>Render in Blender</h3>
    <div class="bl-note">Final-quality Cycles render of this exact view — ${sky.input.date} at ${fmtTime(sky.input.minutes)}, settled linens, physical sky. On an Intel Mac Cycles renders on the CPU; Draft is a quick check.</div>
    <div class="bl-found" data-k="found">${bl ? 'Looking for Blender…' : 'Web version: download a render package and run it with Blender 4.5 LTS.'}</div>
    <div class="bl-presets">
      ${(Object.keys(BLENDER_PRESETS) as RenderSettings['preset'][])
        .map((k, i) => `<label><input type="radio" name="bl-preset" value="${k}" ${i === 0 ? 'checked' : ''}> ${BLENDER_PRESETS[k].label} <small>${BLENDER_PRESETS[k].samples} samples · ${BLENDER_PRESETS[k].minutes}</small></label>`)
        .join('')}
    </div>
    <div class="bl-opts">
      <label><input type="checkbox" data-k="pano"> 360° panorama</label>
      <label><input type="checkbox" data-k="blend" checked> Save .blend</label>
      <label title="Uses the Photo mode focus settings"><input type="checkbox" data-k="dof" ${dof?.enabled ? 'checked' : ''} ${dof ? '' : 'disabled'}> Focus blur</label>
    </div>
    <div class="bl-progress" data-k="prog" hidden><div data-k="ptext">Preparing…</div><div class="bar"><i data-k="pbar"></i></div></div>
    <img class="bl-preview" data-k="preview" hidden alt="Blender render">
    <div class="bl-actions" data-k="actions">
      <button class="ui-btn" data-k="cancel">Close</button>
      ${bl ? '' : '<button class="ui-btn primary" data-k="zip">Download package (.zip)</button>'}
      ${bl ? '<button class="ui-btn primary" data-k="go" disabled>Render</button>' : ''}
    </div>`;
  const q = <T extends HTMLElement>(k: string) => dlg.querySelector(`[data-k="${k}"]`) as T;
  const settings = (): RenderSettings => {
    const preset = (dlg.querySelector('input[name="bl-preset"]:checked') as HTMLInputElement).value as RenderSettings['preset'];
    const p = BLENDER_PRESETS[preset];
    const d = photoMode.getDof();
    return {
      preset,
      w: p.w,
      h: p.h,
      samples: p.samples,
      panorama: q<HTMLInputElement>('pano').checked,
      saveBlend: q<HTMLInputElement>('blend').checked,
      dof: q<HTMLInputElement>('dof').checked && d ? { ...d, enabled: true } : { enabled: false, focusM: 5, fStop: 2.8 },
    };
  };
  const prog = q('prog');
  const ptext = q('ptext');
  const pbar = q('pbar');
  const setProgress = (text: string, frac?: number) => {
    prog.hidden = false;
    ptext.textContent = text;
    if (frac !== undefined) pbar.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  };

  q('cancel').addEventListener('click', () => {
    if (jobId && bl) void bl.cancel(jobId);
    close();
  });
  back.addEventListener('click', (e) => {
    if (e.target === back && !jobId) close();
  });

  (dlg.querySelector('[data-k="zip"]') as HTMLButtonElement | null)?.addEventListener('click', async () => {
    const btn = q<HTMLButtonElement>('zip');
    btn.disabled = true;
    try {
      setProgress('Packaging the scene…', 0.3);
      const pkg = await buildExportPackage(settings());
      setProgress('Compressing…', 0.8);
      const zip = packageToZip(pkg);
      await saveBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `wedding-venue-${sky.input.date}-blender.zip`, [
        { name: 'Zip archive', extensions: ['zip'] },
      ]);
      setProgress('Saved. Unzip it and run render.sh (or see README.txt).', 1);
    } catch (e) {
      console.error(e);
      setProgress(`Export failed: ${(e as Error).message}`);
    } finally {
      btn.disabled = false;
    }
  });

  if (!bl) return;
  const found = q('found');
  const go = q<HTMLButtonElement>('go');
  const showFound = (r: BlenderDetectResult | null) => {
    if (!r) return;
    if (r.found && r.install) {
      found.className = 'bl-found';
      found.textContent = `${r.install.label} — ${r.install.path}`;
      go.disabled = false;
    } else {
      found.className = 'bl-found missing';
      found.innerHTML = r.install
        ? `${r.install.label} found, but this Mac needs <b>Blender 4.5 LTS</b> (the last release for Intel Macs). `
        : 'Blender 4.5 LTS was not found. ';
      const dl = document.createElement('button');
      dl.className = 'ui-btn';
      dl.textContent = 'Download 4.5 LTS';
      dl.addEventListener('click', () => void p.openExternal(r.downloadUrl));
      const loc = document.createElement('button');
      loc.className = 'ui-btn';
      loc.textContent = 'Locate…';
      loc.addEventListener('click', async () => showFound(await bl.choose()));
      found.append(dl, loc);
      go.disabled = true;
    }
  };
  void bl.detect().then(showFound, (e) => {
    found.className = 'bl-found missing';
    found.textContent = `Could not look for Blender: ${(e as Error).message}`;
  });

  go.addEventListener('click', async () => {
    go.disabled = true;
    const s = settings();
    try {
      setProgress('Packaging the scene…', 0.02);
      const pkg = await buildExportPackage(s);
      const files: Record<string, ArrayBuffer | string> = {};
      for (const [k, v] of Object.entries(pkg.files)) files[k] = typeof v === 'string' ? v : (v.slice().buffer as ArrayBuffer);
      const t0 = performance.now();
      unsub = bl.onEvent((id, ev: BlenderEvent) => {
        if (id !== jobId) return;
        if (ev.ev === 'stage') setProgress(stageLabel(ev.stage));
        else if (ev.ev === 'progress') {
          const eta = ev.etaSec ? ` · ~${fmtDur(ev.etaSec)} left` : '';
          const frac = ev.sample && ev.of ? ev.sample / ev.of : ev.pct !== undefined ? ev.pct / 100 : undefined;
          setProgress(ev.sample && ev.of ? `Rendering sample ${ev.sample}/${ev.of}${eta}` : `Rendering…${eta}`, frac);
        } else if (ev.ev === 'result') {
          jobId = null;
          const dev = (ev.script as { device?: string } | undefined)?.device;
          setProgress(`Done in ${fmtDur(ev.elapsedSec)}${dev ? ` (${dev})` : ''}.`, 1);
          const imgName = ev.image?.split('/').pop();
          void showResult(ev.image, ev.blend, imgName ? ev.urls[imgName] : undefined);
        } else if (ev.ev === 'error') {
          jobId = null;
          setProgress(ev.cancelled ? 'Render cancelled.' : `Blender reported an error: ${ev.message}`);
          go.disabled = false;
        }
      });
      const job = await bl.render(files, { preset: s.preset, width: s.w, height: s.h, samples: s.samples });
      jobId = job.jobId;
      setProgress('Starting Blender…', 0.03);
      q('cancel').textContent = 'Cancel';
    } catch (e) {
      console.error(e);
      setProgress(`Could not start the render: ${(e as Error).message}`);
      go.disabled = false;
    }
  });

  const showResult = async (png?: string, blend?: string, url?: string) => {
    q('cancel').textContent = 'Close';
    const actions = q('actions');
    if (png) {
      const reveal = document.createElement('button');
      reveal.className = 'ui-btn';
      reveal.textContent = 'Show in Finder';
      reveal.addEventListener('click', () => void p.showItem(png));
      actions.prepend(reveal);
    }
    if (blend) {
      const ob = document.createElement('button');
      ob.className = 'ui-btn';
      ob.textContent = 'Open .blend';
      ob.addEventListener('click', () => void bl.openBlend(blend));
      actions.prepend(ob);
    }
    if (url) {
      const img = q<HTMLImageElement>('preview');
      img.src = url;
      img.hidden = false;
    }
    toast('Blender render finished');
  };
}

function stageLabel(s: string): string {
  const m: Record<string, string> = {
    import: 'Importing the scene…',
    materials: 'Setting up materials…',
    lights: 'Placing lights…',
    camera: 'Matching the camera…',
    world: 'Building the sky…',
    meter: 'Metering exposure…',
    render: 'Rendering…',
    save: 'Saving…',
  };
  return m[s] ?? `${s}…`;
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = String(Math.round(min % 60)).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}
