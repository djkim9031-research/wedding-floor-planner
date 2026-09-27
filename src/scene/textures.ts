import * as THREE from 'three';
import { barkTextures, bayPanoramaTextureImpl, deckIpeTextures, treetopRingTextureImpl } from './texturesExterior';

// All textures are Canvas2D-generated (single-file CSP: no external assets)
// and seeded so they come out identical on every load.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d')!;
}

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Hardwood floor — 1024px == one 128" tile (8 px/inch), ~5" planks along v.
// ---------------------------------------------------------------------------

export function floorWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  // 2048px == one 128" tile (16 px/in). Classic 2.5" red-oak strip flooring
  // per the venue photos: boards run E-W (u axis), satin sheen, honey→amber.
  const S = 2048;
  const rnd = mulberry32(0xf100d);
  const rows = 51; // 128/51 ≈ 2.5" strips
  const h = S / rows;
  const palette = ['#9C6C41', '#AA7A4B', '#855832', '#B4885A', '#8F6139', '#A17044', '#764C2A'];

  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  ctx.fillStyle = '#7E5230';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#4a4a4a'; // satin base ~0.29
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string; ro: number }[] = [];
    let x = -(60 + rnd() * 700);
    while (x < S) {
      const len = (24 + rnd() * 60) * 16; // 24–84" boards
      segs.push({ x0: x, x1: x + len, c: palette[(rnd() * palette.length) | 0], ro: 0.2 + rnd() * 0.18 });
      x += len;
    }
    segs[segs.length - 1].c = segs[0].c;
    segs[segs.length - 1].ro = segs[0].ro;
    for (const sg of segs) {
      const w = sg.x1 - sg.x0;
      ctx.fillStyle = sg.c;
      ctx.fillRect(sg.x0, y + 0.6, w - 1.2, h - 1.2);
      const g = Math.round(sg.ro * 255);
      rough.fillStyle = `rgb(${g},${g},${g})`;
      rough.fillRect(sg.x0, y + 0.6, w - 1.2, h - 1.2);

      // fine straight grain: many low-alpha length-wise streaks
      const nGrain = 8 + ((rnd() * 6) | 0);
      for (let i = 0; i < nGrain; i++) {
        const dark = rnd() < 0.68;
        ctx.strokeStyle = dark ? '#5E3B1E' : '#D8AC72';
        ctx.globalAlpha = 0.05 + rnd() * 0.1;
        ctx.lineWidth = 0.6 + rnd() * 1.1;
        const gy = y + 2 + rnd() * (h - 4);
        ctx.beginPath();
        ctx.moveTo(sg.x0 + 2, gy);
        let gx = sg.x0 + 2;
        let cy = gy;
        while (gx < sg.x1 - 4) {
          gx += 90 + rnd() * 140;
          cy = Math.min(y + h - 1.5, Math.max(y + 1.5, cy + (rnd() - 0.5) * 3));
          ctx.lineTo(Math.min(gx, sg.x1 - 4), cy);
        }
        ctx.stroke();
      }
      // occasional cathedral arcs
      if (rnd() < 0.4 && w > 300) {
        const cxr = sg.x0 + w * (0.25 + rnd() * 0.5);
        ctx.strokeStyle = '#6B441F';
        for (let a = 0; a < 4; a++) {
          ctx.globalAlpha = 0.1 - a * 0.018;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(cxr, y + h * 0.5, 60 + a * 34, h * (0.16 + a * 0.09), 0, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // end joint
      if (sg.x0 > 0 && sg.x0 < S) {
        ctx.fillStyle = '#4E3115';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        ctx.globalAlpha = 1;
        rough.fillStyle = '#8c8c8c';
        rough.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        bump.fillStyle = '#5a5a5a';
        bump.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
      }
      // per-board tone drift along the length (sun bleach / wear)
      const nW = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < nW; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(236,200,148,1)' : 'rgba(72,44,20,1)';
        ctx.globalAlpha = 0.03 + rnd() * 0.05;
        ctx.fillRect(sg.x0 + rnd() * w, y + 0.6, 60 + rnd() * 220, h - 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // strip joint line + milled micro-bevel (soft to avoid shimmer)
    ctx.fillStyle = '#4E3115';
    ctx.globalAlpha = 0.42;
    ctx.fillRect(0, y + h - 1.1, S, 1.4);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#F0CE96';
    ctx.fillRect(0, y + 0.6, S, 1.2);
    ctx.globalAlpha = 1;
    rough.fillStyle = '#909090';
    rough.fillRect(0, y + h - 1, S, 1.2);
    bump.fillStyle = '#565656';
    bump.fillRect(0, y + h - 1.2, S, 1.6);
    bump.fillStyle = '#a2a2a2';
    bump.fillRect(0, y + 0.4, S, 1);
  }

  const mapTex = toTexture(ctx, true);
  mapTex.anisotropy = 16;
  const roughTex = toTexture(rough, false);
  roughTex.anisotropy = 16;
  const bumpTex = toTexture(bump, false);
  bumpTex.anisotropy = 8;
  return { map: mapTex, roughnessMap: roughTex, bumpMap: bumpTex };
}

// ---------------------------------------------------------------------------

export function reedTexture(): THREE.CanvasTexture {
  const S = 512;
  const rnd = mulberry32(0x2eed);
  const ctx = makeCanvas(S, S);
  const reeds = 32;
  const w = S / reeds;
  const palette = ['#8B5A33', '#93613A', '#7F5230', '#96683F', '#7A4E2C'];

  ctx.fillStyle = '#422A15';
  ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < reeds; r++) {
    const x = r * w;
    ctx.fillStyle = palette[(rnd() * palette.length) | 0];
    ctx.fillRect(x + 0.8, 0, w - 1.6, S);
    // rounded highlight + shaded edge
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#B57F4E';
    ctx.fillRect(x + w * 0.3, 0, w * 0.22, S);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#31200F';
    ctx.fillRect(x + w - 3.4, 0, 2.6, S);
    ctx.globalAlpha = 1;
    // node rings
    const nodes = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < nodes; i++) {
      const y = 10 + rnd() * (S - 22);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#5A3A1E';
      ctx.fillRect(x + 0.8, y, w - 1.6, 2.5);
      ctx.globalAlpha = 1;
    }
  }
  return toTexture(ctx, true);
}

// ---------------------------------------------------------------------------
// Deck boards — oiled Ipe, 192"×96" tile (implementation in texturesExterior).
// ---------------------------------------------------------------------------

export function deckWoodTextures(): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  // Ipe boards, 3.5" on 3/16" gaps (see texturesExterior.ts)
  return deckIpeTextures();
}

// ---------------------------------------------------------------------------

export function oakTableTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 512;
  const rnd = mulberry32(0x0a4);

  interface Stroke {
    y: number;
    amp: number;
    f: number;
    ph: number;
    lw: number;
    alpha: number;
    light: boolean;
  }
  const strokes: Stroke[] = [];
  for (let i = 0; i < 46; i++) {
    strokes.push({
      y: rnd() * S,
      amp: 2 + rnd() * 9,
      f: 0.9 + rnd() * 2.4,
      ph: rnd() * Math.PI * 2,
      lw: 0.8 + rnd() * 1.8,
      alpha: 0.07 + rnd() * 0.13,
      light: rnd() < 0.25,
    });
  }

  const map = makeCanvas(S, S);
  map.fillStyle = '#C68A4F';
  map.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) {
    map.globalAlpha = 0.06 + rnd() * 0.05;
    map.fillStyle = i % 2 ? '#B57A40' : '#D49A5F';
    map.fillRect(0, rnd() * S, S, 30 + rnd() * 80);
  }
  map.globalAlpha = 1;

  const bump = makeCanvas(S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  const wave = (ctx: CanvasRenderingContext2D, st: Stroke, style: string, alpha: number) => {
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = st.lw;
    ctx.beginPath();
    for (let x = -8; x <= S + 8; x += 14) {
      const y = st.y + Math.sin((x / S) * Math.PI * 2 * st.f + st.ph) * st.amp;
      if (x === -8) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  for (const st of strokes) {
    wave(map, st, st.light ? '#E2B276' : '#8F5A2E', st.alpha);
    wave(bump, st, st.light ? '#9A9A9A' : '#5C5C5C', 0.5);
  }
  map.globalAlpha = 1;
  bump.globalAlpha = 1;

  // knots
  for (let i = 0; i < 3; i++) {
    const kx = 40 + rnd() * (S - 80);
    const ky = 40 + rnd() * (S - 80);
    for (let ring = 0; ring < 3; ring++) {
      map.strokeStyle = '#8F5A2E';
      map.globalAlpha = 0.22 - ring * 0.05;
      map.lineWidth = 1.2;
      map.beginPath();
      map.ellipse(kx, ky, 3 + ring * 3.5, 2 + ring * 2.5, rnd(), 0, Math.PI * 2);
      map.stroke();
    }
    map.globalAlpha = 1;
    bump.fillStyle = '#565656';
    bump.globalAlpha = 0.6;
    bump.beginPath();
    bump.ellipse(kx, ky, 3.5, 2.5, 0, 0, Math.PI * 2);
    bump.fill();
    bump.globalAlpha = 1;
  }

  return { map: toTexture(map, true), bumpMap: toTexture(bump, false) };
}

/** Dark-brown teak for the QCC table: straighter, tighter grain than the oak. */
export function teakTableTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 512;
  const rnd = mulberry32(0x7ea);

  const map = makeCanvas(S, S);
  map.fillStyle = '#5E4630';
  map.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) {
    map.globalAlpha = 0.07 + rnd() * 0.05;
    map.fillStyle = i % 2 ? '#4E3A26' : '#6D5238';
    map.fillRect(0, rnd() * S, S, 24 + rnd() * 70);
  }
  map.globalAlpha = 1;

  const bump = makeCanvas(S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  for (let i = 0; i < 58; i++) {
    const y = rnd() * S;
    const amp = 0.6 + rnd() * 2.6; // teak grain runs much straighter
    const f = 0.7 + rnd() * 1.6;
    const ph = rnd() * Math.PI * 2;
    const lw = 0.7 + rnd() * 1.4;
    const light = rnd() < 0.3;
    const alpha = 0.08 + rnd() * 0.12;
    const draw = (ctx: CanvasRenderingContext2D, style: string, a: number) => {
      ctx.strokeStyle = style;
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = -8; x <= S + 8; x += 16) {
        const yy = y + Math.sin((x / S) * Math.PI * 2 * f + ph) * amp;
        if (x === -8) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    };
    draw(map, light ? '#7C6142' : '#3B2B1B', alpha);
    draw(bump, light ? '#969696' : '#606060', 0.45);
  }
  map.globalAlpha = 1;
  bump.globalAlpha = 1;

  return { map: toTexture(map, true), bumpMap: toTexture(bump, false) };
}

// ---------------------------------------------------------------------------
// Sky dome gradient — zenith blue to warm golden horizon.
// ---------------------------------------------------------------------------

export function skyTexture(): THREE.CanvasTexture {
  // Deep Bay-Area blue at the zenith falling to a bright hazy horizon, with
  // faint wisps of cirrus baked in (photos: strong clear blue, milky rim).
  const W = 256;
  const H = 1024;
  const rnd = mulberry32(0x5c1);
  const ctx = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#4B90DE');
  g.addColorStop(0.35, '#7FB8EF');
  g.addColorStop(0.62, '#B8D6F4');
  g.addColorStop(0.8, '#DCE7F0');
  g.addColorStop(0.92, '#E9EBE9');
  g.addColorStop(1, '#EDE4D2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // wispy cirrus: long soft horizontal smears in the upper half
  for (let i = 0; i < 26; i++) {
    const y = H * (0.08 + rnd() * 0.42);
    const x = rnd() * W;
    const len = 40 + rnd() * 150;
    const grad = ctx.createLinearGradient(x, 0, x + len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${0.05 + rnd() * 0.1})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - len, y, len * 2, 2 + rnd() * 7);
  }
  const t = toTexture(ctx, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------

export function valleyTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  const rnd = mulberry32(0x7a11e);
  const ctx = makeCanvas(W, H);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#E8EEF2');
  g.addColorStop(0.45, '#C7D4DC');
  g.addColorStop(0.72, '#93A88B');
  g.addColorStop(1, '#6B7C5E');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const canopyRow = (y: number, rMin: number, rMax: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, y, W, H - y);
    let x = 0;
    while (x < W) {
      const r = rMin + rnd() * (rMax - rMin);
      ctx.beginPath();
      ctx.arc(x, y + r * 0.35, r, 0, Math.PI * 2);
      ctx.fill();
      if (x + r > W) {
        // wrap-around copy keeps the cylinder seam clean
        ctx.beginPath();
        ctx.arc(x - W, y + r * 0.35, r, 0, Math.PI * 2);
        ctx.fill();
      }
      x += r * (0.8 + rnd() * 0.6);
    }
  };
  canopyRow(300, 18, 40, '#9DB294'); // far, hazier row
  canopyRow(382, 28, 58, '#5E7050'); // near row

  // ground the bottom edge
  const gb = ctx.createLinearGradient(0, H - 80, 0, H);
  gb.addColorStop(0, 'rgba(107,124,94,0)');
  gb.addColorStop(1, 'rgba(96,112,84,1)');
  ctx.fillStyle = gb;
  ctx.fillRect(0, H - 80, W, 80);

  // drifting haze streaks
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(232,238,242,1)';
    ctx.globalAlpha = 0.08 + rnd() * 0.1;
    ctx.fillRect(0, 250 + rnd() * 120, W, 5 + rnd() * 12);
  }
  ctx.globalAlpha = 1;

  // fade the top edge to transparent
  const fade = ctx.createLinearGradient(0, 0, 0, 90);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, 90);
  ctx.globalCompositeOperation = 'source-over';

  const t = toTexture(ctx, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Bay Area panorama — full 360°, painted by true compass bearing and rotated
// for the facade azimuth (model −z faces true 50°): hazy East Bay hills and
// the bay NE–E, Hoover Tower at 74°, Stanford foothills S, Santa Cruz
// Mountains W/SW (the one skyline above ~1°), urban forest below.
// ---------------------------------------------------------------------------

export function bayPanoramaTexture(): THREE.CanvasTexture {
  // land/haze-only backplate (sky transparent), horizon at 0–1° from deck
  // eye height; see texturesExterior.ts for the row/azimuth mapping
  return bayPanoramaTextureImpl();
}

// ---------------------------------------------------------------------------
// Plank pavers — the covered entry walk's linear concrete planks (photos:
// mixed cream/greige/gray/tan strips running along the walk).
// ---------------------------------------------------------------------------

export function plankPaverTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const S = 1024; // one 96" tile
  const rnd = mulberry32(0x9aef);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const cols = 16; // 6" wide planks, joints along the walk (v)
  const w = S / cols;
  const tones = ['#D8CFBC', '#C6BEAE', '#AFA89B', '#8D8377', '#6E685F', '#C3A886', '#B8A692', '#9B9287'];

  ctx.fillStyle = '#B7AE9F';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#c8c8c8';
  rough.fillRect(0, 0, S, S);

  for (let c = 0; c < cols; c++) {
    const x = c * w;
    let y = -(rnd() * 400);
    const segs: { y0: number; y1: number; t: string }[] = [];
    while (y < S) {
      const len = 120 + rnd() * 340; // 12–43" planks
      segs.push({ y0: y, y1: y + len, t: tones[(rnd() * tones.length) | 0] });
      y += len;
    }
    segs[segs.length - 1].t = segs[0].t;
    for (const sg of segs) {
      ctx.fillStyle = sg.t;
      ctx.fillRect(x + 1, sg.y0 + 1, w - 2, sg.y1 - sg.y0 - 2);
      // subtle per-plank mottle
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,1)' : 'rgba(60,55,48,1)';
        ctx.globalAlpha = 0.028 + rnd() * 0.045;
        ctx.fillRect(x + 1, sg.y0 + rnd() * (sg.y1 - sg.y0), w - 2, 14 + rnd() * 44);
      }
      ctx.globalAlpha = 1;
      if (sg.y0 > 0 && sg.y0 < S) {
        ctx.fillStyle = 'rgba(74,70,62,0.5)';
        ctx.fillRect(x + 1, sg.y0 - 0.8, w - 2, 1.6);
      }
    }
    // column joint
    ctx.fillStyle = 'rgba(74,70,62,0.55)';
    ctx.fillRect(x + w - 1, 0, 1.4, S);
    rough.fillStyle = '#e0e0e0';
    rough.fillRect(x + w - 1, 0, 1.4, S);
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  return { map, roughnessMap: toTexture(rough, false) };
}

// ---------------------------------------------------------------------------
// Diorite-grey fiberstone — Pottery Pots planter finish: warm grey cement,
// dense dark/light speckle, faint horizontal casting bands. u wraps the pot.
// ---------------------------------------------------------------------------

export function dioriteTextures(): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const S = 512;
  const rnd = mulberry32(0xd107173);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);

  ctx.fillStyle = '#8F8C86';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#e6e6e6';
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  // large soft mottle so the five pot sizes don't read flat
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 60 + rnd() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() < 0.5 ? '#9C9992' : '#7F7C75';
    g.addColorStop(0, tone);
    g.addColorStop(1, 'rgba(143,140,134,0)');
    ctx.globalAlpha = 0.05 + rnd() * 0.05;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  // faint horizontal casting bands
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#B0ACA4' : '#6F6C66';
    ctx.globalAlpha = 0.035 + rnd() * 0.02;
    ctx.fillRect(0, rnd() * S, S, 3 + rnd() * 6);
  }
  ctx.globalAlpha = 1;

  // speckle: dark grit + lighter aggregate flecks
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = '#55524C';
    ctx.globalAlpha = 0.35 + rnd() * 0.35;
    const s = 0.7 + rnd() * 1.6;
    ctx.fillRect(rnd() * S, rnd() * S, s, s);
    if (i < 1400) {
      ctx.fillStyle = '#B8B4AC';
      ctx.globalAlpha = 0.3 + rnd() * 0.2;
      ctx.fillRect(rnd() * S, rnd() * S, s, s);
    }
    if (i < 900) {
      rough.fillStyle = rnd() < 0.5 ? '#f2f2f2' : '#d6d6d6';
      rough.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
  }
  ctx.globalAlpha = 1;

  // pores — the cast fiberstone's pitted, sponge-like surface: small dark
  // pits with a faint lit lower rim, recessed in the bump map
  for (let i = 0; i < 650; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.8 + rnd() * 2.4;
    ctx.globalAlpha = 0.4 + rnd() * 0.4;
    ctx.fillStyle = '#4A4740';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.18 + rnd() * 0.12;
    ctx.fillStyle = '#C9C5BC';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.9, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    bump.fillStyle = '#282828';
    (bump as CanvasRenderingContext2D).globalAlpha = 0.7;
    bump.beginPath();
    bump.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    bump.fill();
    // pores hold shade — rougher than the surrounding skin
    rough.fillStyle = '#ffffff';
    rough.globalAlpha = 0.5;
    rough.beginPath();
    rough.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    rough.fill();
    rough.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
  bump.globalAlpha = 1;

  // fine bump grain so the skin shimmers like rough cast stone
  for (let i = 0; i < 2600; i++) {
    bump.fillStyle = rnd() < 0.5 ? '#6a6a6a' : '#969696';
    bump.globalAlpha = 0.5;
    bump.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  bump.globalAlpha = 1;

  const map = toTexture(ctx, true);
  map.anisotropy = 8;
  map.repeat.set(2, 1);
  const roughnessMap = toTexture(rough, false);
  roughnessMap.repeat.set(2, 1);
  const bumpMap = toTexture(bump, false);
  bumpMap.repeat.set(2, 1);
  return { map, roughnessMap, bumpMap };
}

// ---------------------------------------------------------------------------
// Live-oak bark — grey, furrowed, lichen-mottled; v runs along the limb.
// ---------------------------------------------------------------------------

export function barkTexture(): THREE.CanvasTexture {
  // grey, lichen-mottled coast live oak bark (texturesExterior.ts)
  return barkTextures('oak').map;
}

// ---------------------------------------------------------------------------
// Near treetop ring — an alpha-cut band of canopy encircling the knoll just
// beyond the deck, for parallax between the railing and the painted valley.
// ---------------------------------------------------------------------------

export function treetopRingTexture(): THREE.CanvasTexture {
  // mid-distance oak woodland crowns, all below the horizon
  return treetopRingTextureImpl();
}

