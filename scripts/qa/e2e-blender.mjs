#!/usr/bin/env node
// End-to-end check of the Blender handoff: boot the built app headless,
// export the Blender package (#export=zip), unzip it and render it with the
// real Cycles (pip bpy 4.5 here, Blender 4.5 LTS on the user's Mac).
//
//   node scripts/qa/e2e-blender.mjs --hash "preset=Wedding+layout&cam=close&sun=2026-09-20,19:15" \
//        --out .shots/e2e --res 480x270 --samples 32 [--viewport 1280x720]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = resolve(opt('out', '.shots/e2e'));
const hash = opt('hash', 'preset=Wedding+layout&cam=close&sun=2026-09-20,19:15');
const [rw, rh] = opt('res', '480x270').split('x').map(Number);
const samples = opt('samples', '32');
const [vw, vh] = opt('viewport', '1280x720').split('x').map(Number);
const python = opt('python', 'python3');
const extra = opt('args', '').split(' ').filter(Boolean); // passed through to render_venue.py
mkdirSync(out, { recursive: true });

const port = Number(opt('port', String(4300 + Math.floor(Math.random() * 600))));
try {
  await fetch(`http://localhost:${port}/`);
  throw new Error(`port ${port} is already in use — kill the stale server (pkill -f "vite preview") and retry`);
} catch (e) {
  if (e instanceof Error && e.message.startsWith('port ')) throw e;
}
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--outDir', opt('dist', 'dist')], {
  stdio: 'ignore',
  detached: true,
});
const base = `http://localhost:${port}`;
for (let t = 0; ; t++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* starting */
  }
  if (t > 120) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 250));
}

const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let exitCode = 1;
try {
  // the export takes its aspect from --res. Keep the short side >= 700 px:
  // smaller windows switch the cloth to its coarse tier (3" grid, no
  // subdivision), whose folds let table edges show through the linen
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/#${hash}&settle=fast&export=zip&w=${rw}&h=${rh}&samples=${samples}`);
  await page.waitForFunction(() => window.__wpExport || window.__wpQA?.exportError, null, { timeout: 300000 });
  const exp = await page.evaluate(() => window.__wpExport);
  if (!exp) throw new Error('export failed: ' + errors.join('\n'));
  const zip = Buffer.from(exp.zipBase64, 'base64');
  writeFileSync(`${out}/package.zip`, zip);
  try {
    await page.screenshot({ path: `${out}/app.png`, timeout: 120000 });
  } catch (e) {
    console.log('app screenshot skipped: ' + String(e).split('\n')[0]);
  }
  // the page keeps drawing frames (software GL) — shut the browser and the
  // preview server before Cycles starts, or they take half the CPU from it
  await browser.close();
  stopServer();
  const job = `${out}/job`;
  mkdirSync(job, { recursive: true });
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) writeFileSync(`${job}/${name}`, data);
  console.log(`package: ${(zip.length / 1e6).toFixed(2)} MB, lights ${exp.json.lights.length}, checkpoints ${exp.json.checkpoints.length}`);

  const t0 = Date.now();
  const r = spawnSync(python, [`${job}/render_venue.py`, '--job', job, '--res', `${rw}x${rh}`, '--samples', samples, ...extra], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  const events = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.match(/@@WP (\{.*\})$/))
    .filter(Boolean)
    .map((m) => JSON.parse(m[1]));
  writeFileSync(`${out}/blender.log`, (r.stdout ?? '') + '\n--- stderr ---\n' + (r.stderr ?? ''));
  const check = events.find((e) => e.ev === 'check');
  const result = events.find((e) => e.ev === 'result');
  const err = events.find((e) => e.ev === 'error');
  console.log(`blender exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (check) console.log(`camera checkpoints: ${JSON.stringify(check)}`);
  if (err) console.log(`error: ${err.message}`);
  for (const w of events.filter((e) => e.ev === 'warn')) console.log(`warn: ${w.message}`);
  if (result) console.log(`result: ${result.png}`);
  exitCode = r.status === 0 && result ? 0 : 1;
} finally {
  await browser.close().catch(() => {});
  stopServer();
}
process.exit(exitCode);
