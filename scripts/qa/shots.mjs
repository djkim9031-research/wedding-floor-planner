#!/usr/bin/env node
// Headless screenshot harness: serves the app (vite preview of dist/ by
// default), loads each matrix entry's #hash in a fresh browser context,
// waits for boot + cloth idle, and writes <out>/<name>.png. Fails on page
// errors so a broken boot never produces a "passing" black frame.
//
//   node scripts/qa/shots.mjs --matrix scripts/qa/matrix.core.json --out .shots/base
//   node scripts/qa/shots.mjs --hash "demo=dinner&cam=close" --name dinner --out .shots/x
//   options: --serve preview|dev|none  --base http://host:port  --size 1280x800
//            --only name1,name2  --timeout 90000  --keep-going  --dist dist  --port N
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const flag = (k) => args.includes(`--${k}`);

const out = resolve(opt('out', '.shots/latest'));
const serve = opt('serve', 'preview');
const [W, H] = opt('size', '1280x800').split('x').map(Number);
const timeout = Number(opt('timeout', '150000'));
const only = opt('only', '')
  .split(',')
  .filter(Boolean);

let matrix;
if (opt('hash')) {
  matrix = [{ name: opt('name', 'shot'), hash: opt('hash'), waitMs: Number(opt('wait', '0')) }];
} else {
  matrix = JSON.parse(readFileSync(resolve(opt('matrix', 'scripts/qa/matrix.core.json')), 'utf8'));
}
if (only.length) matrix = matrix.filter((m) => only.includes(m.name));
mkdirSync(out, { recursive: true });

async function startServer() {
  if (serve === 'none') return { base: opt('base', 'http://localhost:4173'), stop() {} };
  // random port so parallel runs (git worktrees on one machine) never collide
  const port = Number(opt('port', String(4300 + Math.floor(Math.random() * 600))));
  const cmd =
    serve === 'dev'
      ? ['vite', '--port', String(port), '--strictPort']
      : ['vite', 'preview', '--port', String(port), '--strictPort', '--outDir', opt('dist', 'dist')];
  // a server left over from an earlier run would silently serve a stale build
  try {
    await fetch(`http://localhost:${port}/`);
    throw new Error(`port ${port} is already in use — kill the stale server (pkill -f "vite preview") and retry`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('port ')) throw e;
  }
  const child = spawn('npx', cmd, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 30000) throw new Error('server did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    base,
    stop() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
}

const server = await startServer();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});

const summary = [];
let failed = 0;
try {
  for (const m of matrix) {
    const ctx = await browser.newContext({ viewport: { width: m.w ?? W, height: m.h ?? H }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push('console: ' + msg.text());
    });
    const t0 = Date.now();
    let status = 'ok';
    try {
      await page.goto(`${server.base}/#${m.hash}`, { waitUntil: 'load', timeout });
      await page.waitForFunction(() => window.__wpBooted === true, null, { timeout });
      await page.waitForFunction(() => window.__wpIdle === true, null, { timeout });
      if (m.waitFor) await page.waitForFunction(m.waitFor, null, { timeout });
      if (m.waitMs) await page.waitForTimeout(m.waitMs);
      // two more frames so the last render lands on the canvas
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: `${out}/${m.name}.png`, timeout });
      if (m.qa) {
        const qa = await page.evaluate(() => window.__wpQA ?? null);
        writeFileSync(`${out}/${m.name}.qa.json`, JSON.stringify(qa, null, 2));
      }
    } catch (e) {
      status = 'error: ' + String(e).split('\n')[0];
      try {
        await page.screenshot({ path: `${out}/${m.name}.FAILED.png`, timeout: 60000 });
      } catch {
        /* page gone */
      }
    }
    const real = errors.filter((e) => !/Download the React DevTools|favicon/.test(e));
    if (real.length && status === 'ok') status = 'page-errors';
    if (status !== 'ok') failed++;
    summary.push({ name: m.name, status, ms: Date.now() - t0, errors: real.slice(0, 5) });
    console.log(`${status === 'ok' ? '✓' : '✗'} ${m.name} (${Date.now() - t0} ms) ${status === 'ok' ? '' : status}`);
    for (const e of real.slice(0, 5)) console.log('    ' + e.slice(0, 300));
    await ctx.close();
    if (failed && !flag('keep-going') && status !== 'ok') break;
  }
} finally {
  await browser.close();
  server.stop();
}
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
process.exit(failed ? 1 : 0);
