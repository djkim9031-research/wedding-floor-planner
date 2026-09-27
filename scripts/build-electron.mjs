#!/usr/bin/env node
// Bundle the Electron main process and preload with esbuild:
//   electron/main.ts    → dist-electron/main.cjs
//   electron/preload.ts → dist-electron/preload.cjs  (sandboxed: only `electron` is external)
// The renderer is the regular vite build in dist/ (npm run build).
//   node scripts/build-electron.mjs [--watch]
import { build, context } from 'esbuild';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist-electron');
const watch = process.argv.includes('--watch');

rmSync(outdir, { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: root,
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  sourcesContent: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching electron/ …');
} else {
  await build(options);
  for (const f of ['main.cjs', 'preload.cjs']) {
    if (!existsSync(resolve(outdir, f))) {
      console.error(`build-electron: ${f} was not produced`);
      process.exit(1);
    }
  }
  if (!existsSync(resolve(root, 'dist/index.html'))) {
    console.warn('build-electron: dist/index.html is missing — run `npm run build` (npm run electron:build does both)');
  }
}
