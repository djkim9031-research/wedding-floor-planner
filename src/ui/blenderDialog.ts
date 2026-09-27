import './blender.css';
import { buildExportPackage, packageToZip } from '../render/export/exportPackage';
import { BLENDER_PRESETS, type RenderSettings } from '../render/export/sceneJson';
import { photoMode } from '../render/photo/photoMode';
import { saveBlob } from '../render/photo/save';
import { getSky } from '../sky/skyStore';

/** Native bridge surface used here (see electron/preload.ts). */
interface BlenderBridge {
  detect(): Promise<{ path: string; version: string; supported: boolean } | null>;
  choose(): Promise<{ path: string; version: string; supported: boolean } | null>;
  render(files: Record<string, ArrayBuffer | string>, opts: { preset: string; w: number; h: number; samples: number }): Promise<string>;
  cancel(jobId: string): void;
  onEvent(cb: (jobId: string, ev: BlenderEvent) => void): () => void;
  openBlend?(path: string): void;
  readImage?(path: string): Promise<ArrayBuffer | null>;
}
type BlenderEvent =
  | { ev: 'stage'; stage: string; t?: number }
  | { ev: 'progress'; sample: number; of: number; pct?: number; etaSec?: number }
  | { ev: 'result'; png: string; blend?: string; ms?: number; device?: string }
  | { ev: 'error'; message: string; trace?: string };

function bridge(): { blender?: BlenderBridge; showItem?(p: string): void; openExternal?(u: string): void } | null {
  return (window as unknown as { wpNative?: { blender?: BlenderBridge; showItem?(p: string): void; openExternal?(u: string): void } }).wpNative ?? null;
}

const DOWNLOAD_URL = 'https://www.blender.org/download/lts/4-5/';

let open = false;

export function openBlenderDialog(toast: (m: string) => void): void {
  if (open) return;
  open = true;
  const native = bridge();
  const bl = native?.blender;
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
    if (jobId && bl) bl.cancel(jobId);
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
  const showFound = (b: { path: string; version: string; supported: boolean } | null) => {
    if (b && b.supported) {
      found.className = 'bl-found';
      found.textContent = `Blender ${b.version} — ${b.path}`;
      go.disabled = false;
    } else {
      found.className = 'bl-found missing';
      found.innerHTML = b
        ? `Blender ${b.version} found, but this Mac needs <b>Blender 4.5 LTS</b> (the last release for Intel Macs). `
        : 'Blender 4.5 LTS was not found. ';
      const dl = document.createElement('button');
      dl.className = 'ui-btn';
      dl.textContent = 'Download 4.5 LTS';
      dl.addEventListener('click', () => native?.openExternal?.(DOWNLOAD_URL));
      const loc = document.createElement('button');
      loc.className = 'ui-btn';
      loc.textContent = 'Locate…';
      loc.addEventListener('click', async () => showFound(await bl.choose()));
      found.append(dl, loc);
      go.disabled = true;
    }
  };
  void bl.detect().then(showFound, () => showFound(null));

  go.addEventListener('click', async () => {
    go.disabled = true;
    const s = settings();
    try {
      setProgress('Packaging the scene…', 0.02);
      const pkg = await buildExportPackage(s);
      const files: Record<string, ArrayBuffer | string> = {};
      for (const [k, v] of Object.entries(pkg.files)) files[k] = typeof v === 'string' ? v : (v.slice().buffer as ArrayBuffer);
      const t0 = performance.now();
      unsub = bl.onEvent((id, ev) => {
        if (id !== jobId) return;
        if (ev.ev === 'stage') setProgress(stageLabel(ev.stage));
        else if (ev.ev === 'progress') {
          const eta = ev.etaSec ? ` · ~${fmtDur(ev.etaSec)} left` : '';
          setProgress(`Rendering sample ${ev.sample}/${ev.of}${eta}`, ev.sample / ev.of);
        } else if (ev.ev === 'result') {
          jobId = null;
          setProgress(`Done in ${fmtDur((performance.now() - t0) / 1000)}${ev.device ? ` (${ev.device})` : ''}.`, 1);
          void showResult(ev.png, ev.blend);
        } else if (ev.ev === 'error') {
          jobId = null;
          setProgress(`Blender reported an error: ${ev.message}`);
          go.disabled = false;
        }
      });
      jobId = await bl.render(files, { preset: s.preset, w: s.w, h: s.h, samples: s.samples });
      setProgress('Starting Blender…', 0.03);
      q('cancel').textContent = 'Cancel';
    } catch (e) {
      console.error(e);
      setProgress(`Could not start the render: ${(e as Error).message}`);
      go.disabled = false;
    }
  });

  const showResult = async (png: string, blend?: string) => {
    q('cancel').textContent = 'Close';
    const actions = q('actions');
    const reveal = document.createElement('button');
    reveal.className = 'ui-btn';
    reveal.textContent = 'Show in Finder';
    reveal.addEventListener('click', () => native?.showItem?.(png));
    actions.prepend(reveal);
    if (blend && bl.openBlend) {
      const ob = document.createElement('button');
      ob.className = 'ui-btn';
      ob.textContent = 'Open .blend';
      ob.addEventListener('click', () => bl.openBlend!(blend));
      actions.prepend(ob);
    }
    const bytes = await bl.readImage?.(png);
    if (bytes) {
      const img = q<HTMLImageElement>('preview');
      img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
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
