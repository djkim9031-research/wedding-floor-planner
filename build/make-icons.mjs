#!/usr/bin/env node
// Renders the app icon (build/icon.png 1024², build/icon.icns) and the DMG
// window background (build/background.png 540×380 + @2x) from SVG/HTML with
// headless Chromium (playwright-core). The outputs are committed; re-run
// with `npm run icons` after changing the artwork.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const out = (f) => resolve(here, f);
mkdirSync(here, { recursive: true });

// ---- artwork -------------------------------------------------------------------

/** Lobed oak leaf along +y (base at 0, tip at len), as an SVG path. */
function oakLeafPath(len, width) {
  const n = 64;
  const right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // envelope: narrow stalk, broad upper-middle, rounded tip
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.75) * (0.55 + 0.45 * t);
    // 4 rounded lobes per side
    const lobe = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(Math.PI * 4.5 * t)), 0.6);
    const w = t < 0.06 ? 0.035 : width * env * lobe;
    right.push([w, t * len]);
  }
  const pts = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    d += ` Q ${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

function iconSvg() {
  const chairs = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 360 + 22.5;
    chairs.push(
      `<g transform="rotate(${a} 512 512) translate(512 ${512 - 318})">` +
        `<rect x="-52" y="-34" width="104" height="68" rx="22" fill="url(#chair)" stroke="#6f7d62" stroke-width="3"/>` +
        `<rect x="-44" y="-44" width="88" height="16" rx="8" fill="#76855f"/></g>`,
    );
  }
  const plates = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI + Math.PI / 8;
    const x = 512 + Math.sin(a) * 178;
    const y = 512 - Math.cos(a) * 178;
    plates.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="30" fill="#fffdf8" stroke="#c9ab7c" stroke-width="4"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="19" fill="none" stroke="#e7dfd4" stroke-width="3"/>`,
    );
  }
  const leaf = oakLeafPath(270, 84);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fcf8f1"/><stop offset="1" stop-color="#eee4d3"/>
    </linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2c48d"/><stop offset="0.45" stop-color="#b08d57"/>
      <stop offset="0.7" stop-color="#d4b47c"/><stop offset="1" stop-color="#8e6d3d"/>
    </linearGradient>
    <radialGradient id="linen" cx="0.45" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#fffdf9"/><stop offset="1" stop-color="#f1e9dc"/>
    </radialGradient>
    <linearGradient id="chair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a3b294"/><stop offset="1" stop-color="#8a9a7b"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7f9a5c"/><stop offset="1" stop-color="#5d7443"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#3a2f22" flood-opacity="0.32"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#5a4630" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#plate)"/>
  </g>
  <rect x="104" y="104" width="816" height="816" rx="182" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="4"/>
  <g filter="url(#soft)">${chairs.join('')}</g>
  <g filter="url(#soft)">
    <circle cx="512" cy="512" r="262" fill="url(#linen)"/>
    <circle cx="512" cy="512" r="262" fill="none" stroke="url(#brass)" stroke-width="30"/>
    <circle cx="512" cy="512" r="238" fill="none" stroke="#b08d57" stroke-opacity="0.35" stroke-width="3"/>
  </g>
  ${plates.join('')}
  <g transform="translate(512 512) rotate(-32) translate(0 -138)">
    <path d="${leaf}" fill="url(#leaf)" stroke="#4d6238" stroke-width="3"/>
    <path d="M0 -10 L0 258" stroke="#d9bf8a" stroke-width="6" stroke-linecap="round"/>
    ${[0.3, 0.45, 0.6, 0.75]
      .map((t) => `<path d="M0 ${270 * t} l ${-44 + t * 20} ${-26} M0 ${270 * t} l ${44 - t * 20} ${-26}" stroke="#d9bf8a" stroke-width="3.5" stroke-linecap="round"/>`)
      .join('')}
  </g>
</svg>`;
}

function backgroundHtml() {
  return `<!doctype html><html><head><style>
  html,body{margin:0;width:540px;height:380px;overflow:hidden}
  body{background:linear-gradient(180deg,#f7f2ea 0%,#efe9df 100%);font-family:'Liberation Serif','DejaVu Serif',Georgia,serif;color:#4a443d}
  .t{position:absolute;top:26px;left:0;right:0;text-align:center;font-size:22px;letter-spacing:.02em}
  .s{position:absolute;top:56px;left:0;right:0;text-align:center;font:600 10.5px 'Liberation Sans','DejaVu Sans',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a38a63}
  .d{position:absolute;top:292px;left:0;right:0;text-align:center;font-size:15px;font-style:italic;color:#6b6258}
  .n{position:absolute;bottom:18px;left:24px;right:24px;text-align:center;font:11px/1.45 'Liberation Sans','DejaVu Sans',sans-serif;color:#8d8478}
  .rule{position:absolute;top:84px;left:236px;width:68px;height:1px;background:#c9ab7c}
  svg{position:absolute;left:0;top:0}
  </style></head><body>
  <div class="t">Wedding Venue Studio</div><div class="s">Planner · Photo mode · Blender renders</div><div class="rule"></div>
  <svg width="540" height="380" viewBox="0 0 540 380">
    <path d="M214 178 C 250 160, 292 160, 322 176" fill="none" stroke="#b08d57" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
    <path d="M314 166 L 330 179 L 311 186" fill="none" stroke="#b08d57" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <div class="d">Drag the app onto Applications</div>
  <div class="n">First launch: System Settings › Privacy &amp; Security › <b>Open Anyway</b></div>
  </body></html>`;
}

// ---- icns ------------------------------------------------------------------------

/** PNG-in-ICNS container (macOS 10.7+ reads PNG for all of these types). */
function icns(pngBySize) {
  const types = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ];
  const chunks = types.map(([type, size]) => {
    const png = pngBySize.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ---- render ------------------------------------------------------------------------

const browser = await chromium.launch({ headless: true });
try {
  const svg = iconSvg();
  writeFileSync(out('icon.svg'), svg);
  const pngs = new Map();
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`) +
        `</body></html>`,
    );
    pngs.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
  }
  writeFileSync(out('icon.png'), pngs.get(1024));
  writeFileSync(out('icon.icns'), icns(pngs));

  for (const [scale, name] of [
    [1, 'background.png'],
    [2, 'background@2x.png'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 540, height: 380 }, deviceScaleFactor: scale });
    await page.setContent(backgroundHtml());
    await page.screenshot({ path: out(name) });
    await page.close();
  }
  console.log('wrote build/icon.png, build/icon.icns, build/icon.svg, build/background.png, build/background@2x.png');
} finally {
  await browser.close();
}
