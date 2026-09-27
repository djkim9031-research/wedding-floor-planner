#!/usr/bin/env node
// Pixel diff two screenshot folders: node scripts/qa/diff.mjs <a> <b> [--threshold 0.1] [--out dir]
// Prints per-image mismatch % and writes red diff images to <out> (default <b>/diff).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [a, b] = process.argv.slice(2, 4).map((p) => resolve(p));
const args = process.argv.slice(4);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const threshold = Number(opt('threshold', '0.1'));
const outDir = resolve(opt('out', join(b, 'diff')));
mkdirSync(outDir, { recursive: true });

const rows = [];
for (const f of readdirSync(a).filter((f) => f.endsWith('.png') && !f.includes('FAILED'))) {
  const pb = join(b, f);
  if (!existsSync(pb)) {
    rows.push({ name: f, pct: null, note: 'missing in b' });
    continue;
  }
  const A = PNG.sync.read(readFileSync(join(a, f)));
  const B = PNG.sync.read(readFileSync(pb));
  if (A.width !== B.width || A.height !== B.height) {
    rows.push({ name: f, pct: null, note: 'size differs' });
    continue;
  }
  const D = new PNG({ width: A.width, height: A.height });
  const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold });
  const pct = (100 * n) / (A.width * A.height);
  if (n) writeFileSync(join(outDir, f), PNG.sync.write(D));
  rows.push({ name: f, pct: +pct.toFixed(3), pixels: n });
}
for (const r of rows) console.log(`${r.pct === null ? '??' : r.pct.toFixed(3).padStart(8)}%  ${r.name}${r.note ? '  ' + r.note : ''}`);
writeFileSync(join(outDir, 'diff.json'), JSON.stringify(rows, null, 2));
