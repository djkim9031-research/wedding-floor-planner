// Shared Blender prompts for the Mac app: "Blender not found" (download link
// to 4.5 LTS — the last release with an Intel Mac build — or pick one by
// hand) and a status box. The export/render UI calls ensureBlender() before
// starting a job.
import { messageBox } from '../ui/dialog';
import { platform, type BlenderDetectResult } from './bridge';

export function describeBlender(r: BlenderDetectResult): string {
  if (!r.install) return 'Not found';
  return `${r.install.label} — ${r.install.app ?? r.install.path}`;
}

/**
 * Resolves a usable Blender, asking the user when none is found (Download /
 * Choose…). Null when the user gave up or on the web build.
 */
export async function ensureBlender(): Promise<BlenderDetectResult | null> {
  const p = platform();
  if (!p.native) return null;
  let r = await p.blender.detect();
  for (;;) {
    if (r.found) return r;
    const choice = await showBlenderMissing(r);
    if (choice === 'download') {
      await p.openExternal(r.downloadUrl);
      return null;
    }
    if (choice !== 'choose') return null;
    const picked = await p.blender.choose();
    if (!picked) return null;
    r = picked;
  }
}

export async function showBlenderMissing(r: BlenderDetectResult): Promise<'download' | 'choose' | 'close'> {
  const unsupported = r.install && !r.install.supported;
  const i = await messageBox(
    unsupported ? 'Blender version not supported' : 'Blender not found',
    unsupported
      ? `Found ${r.install!.label}, but Render in Blender needs Blender 4.2 – 4.5.`
      : 'Render in Blender uses Blender 4.5 LTS to path-trace the scene with Cycles.',
    {
      detail:
        (r.warning ? r.warning + '\n\n' : '') +
        'Install Blender 4.5 LTS (the last version with an Intel Mac build) into Applications, ' +
        'or choose where it is installed.',
      buttons: ['Close', 'Choose Blender…', 'Download Blender 4.5 LTS'],
      width: 500,
      defaultId: 2,
      cancelId: 0,
    },
  );
  return i === 2 ? 'download' : i === 1 ? 'choose' : 'close';
}

/** Default "Render in Blender…" menu action until the export UI claims it. */
export async function showBlenderStatus(): Promise<void> {
  const p = platform();
  if (!p.native) return;
  const r = await ensureBlender();
  if (!r?.install) return;
  await messageBox('Blender is ready', describeBlender(r), {
    detail: r.warning ?? 'Render in Blender exports the current view and renders it with Cycles.',
  });
}
