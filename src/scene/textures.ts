import * as THREE from 'three';

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
// Hardwood floor — 2048px == one 128" tile (16 px/in).
// ---------------------------------------------------------------------------

export function floorWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  // Honey-toned select red oak, 2¼" strips (reference photos 02/05): the
  // board seams run parallel to the image horizon in both hall photos — one
  // looks south, one north — so the strips run E-W (u axis), not N-S. Satin
  // finish (clearcoat in the render tag), random-length boards, open grain.
  const S = 2048;
  const PX = 16; // px per inch
  const rnd = mulberry32(0xf100d);
  const rows = 57; // 128/57 ≈ 2.25" strips
  const h = S / rows;
  // honey → amber with the odd pale sapwood and deeper heart board
  const palette = ['#C8904F', '#C08849', '#CF9A5A', '#B98046', '#D6A566', '#C38C4D', '#AE7640', '#CB9556', '#DCAD6E', '#BA8347'];

  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  ctx.fillStyle = '#8A5A30';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#5a5a5a';
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string; ro: number }[] = [];
    let x = -(40 + rnd() * 900);
    while (x < S) {
      const len = (14 + rnd() * 62) * PX; // 14–76" boards
      segs.push({ x0: x, x1: x + len, c: palette[(rnd() * palette.length) | 0], ro: 0.26 + rnd() * 0.12 });
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

      // open red-oak grain: long dark streaks, pale latewood lines
      const nGrain = 10 + ((rnd() * 8) | 0);
      for (let i = 0; i < nGrain; i++) {
        const dark = rnd() < 0.72;
        ctx.strokeStyle = dark ? '#6A3F1C' : '#E8C48A';
        ctx.globalAlpha = dark ? 0.07 + rnd() * 0.13 : 0.05 + rnd() * 0.08;
        ctx.lineWidth = 0.5 + rnd() * 1.3;
        const gy = y + 2 + rnd() * (h - 4);
        ctx.beginPath();
        ctx.moveTo(sg.x0 + 2, gy);
        let gx = sg.x0 + 2;
        let cy = gy;
        while (gx < sg.x1 - 4) {
          gx += 60 + rnd() * 120;
          cy = Math.min(y + h - 1.5, Math.max(y + 1.5, cy + (rnd() - 0.5) * 2.4));
          ctx.lineTo(Math.min(gx, sg.x1 - 4), cy);
        }
        ctx.stroke();
      }
      // pore flecks
      ctx.fillStyle = '#4F2E12';
      const nPore = (w / 12) | 0;
      for (let i = 0; i < nPore; i++) {
        ctx.globalAlpha = 0.12 + rnd() * 0.18;
        ctx.fillRect(sg.x0 + rnd() * w, y + 1.5 + rnd() * (h - 3), 3 + rnd() * 9, 0.9);
      }
      // flat-sawn cathedral arches
      if (rnd() < 0.55 && w > 260) {
        const cxr = sg.x0 + w * (0.2 + rnd() * 0.6);
        ctx.strokeStyle = '#6E421E';
        const n = 3 + ((rnd() * 3) | 0);
        for (let a = 0; a < n; a++) {
          ctx.globalAlpha = 0.13 - a * 0.02;
          ctx.lineWidth = 1 + rnd() * 0.6;
          ctx.beginPath();
          ctx.ellipse(cxr + a * 10, y + h * 0.5, 50 + a * 38 + rnd() * 20, h * (0.14 + a * 0.08), 0, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // end joint (butt seam)
      if (sg.x0 > 0 && sg.x0 < S) {
        ctx.fillStyle = '#4A2C12';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        ctx.globalAlpha = 1;
        rough.fillStyle = '#8c8c8c';
        rough.fillRect(sg.x0 - 0.8, y + 0.6, 1.6, h - 1.2);
        bump.fillStyle = '#4a4a4a';
        bump.fillRect(sg.x0 - 1, y + 0.6, 2, h - 1.2);
      }
      // per-board tone drift along the length (wear, finish build-up)
      const nW = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < nW; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(244,210,150,1)' : 'rgba(96,56,24,1)';
        ctx.globalAlpha = 0.03 + rnd() * 0.05;
        ctx.fillRect(sg.x0 + rnd() * w, y + 0.6, 50 + rnd() * 200, h - 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // strip seam + milled micro-bevel (soft to avoid shimmer)
    ctx.fillStyle = '#4A2C12';
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, y + h - 1.1, S, 1.4);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#F4D49E';
    ctx.fillRect(0, y + 0.6, S, 1.2);
    ctx.globalAlpha = 1;
    rough.fillStyle = '#909090';
    rough.fillRect(0, y + h - 1, S, 1.2);
    bump.fillStyle = '#4e4e4e';
    bump.fillRect(0, y + h - 1.3, S, 1.8);
    bump.fillStyle = '#6a6a6a';
    bump.fillRect(0, y + h - 2.6, S, 1.3);
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
// Reed / stick-mat ceiling infill — 1024px == one 48" × 48" tile (21⅓ px/in).
// Sticks run along v (laid along the ridge, spanning rafter to rafter, per
// reference photos 02/05); u runs up the slope.
// ---------------------------------------------------------------------------

/** inches covered by one reed tile in u and v */
export const REED_TILE_IN = 48;

export function reedTexture(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 1024;
  const PX = S / REED_TILE_IN;
  const rnd = mulberry32(0x2eed);
  const ctx = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  // light warm tan / honey canes with the odd darker, greyer stick
  const palette = ['#B8946A', '#AE8A5E', '#C09C70', '#A6825A', '#B48E62', '#C6A474', '#9E7C56', '#BA966A', '#AA8862', '#8E7052'];

  // widths 0.55–0.9" that sum exactly to the tile so u wraps seamlessly
  const widths: number[] = [];
  let tot = 0;
  while (tot < S - 0.5 * PX) {
    const w = (0.55 + rnd() * 0.35) * PX;
    widths.push(w);
    tot += w;
  }
  const k = S / tot;

  ctx.fillStyle = '#4A3624'; // shadowed gaps between canes
  ctx.fillRect(0, 0, S, S);
  bump.fillStyle = '#000000';
  bump.fillRect(0, 0, S, S);

  let x = 0;
  for (const w0 of widths) {
    const w = w0 * k;
    const gap = 0.9 + rnd() * 1.3;
    const x0 = x + gap / 2;
    const x1 = x + w - gap / 2;
    const cw = x1 - x0;
    const base = palette[(rnd() * palette.length) | 0];
    // round cane: shaded edges, soft highlight a little off-centre
    const hl = 0.35 + rnd() * 0.2;
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, 'rgba(40,26,14,0.42)');
    grad.addColorStop(0.18, 'rgba(40,26,14,0.08)');
    grad.addColorStop(hl, 'rgba(255,236,200,0.14)');
    grad.addColorStop(0.82, 'rgba(40,26,14,0.07)');
    grad.addColorStop(1, 'rgba(40,26,14,0.46)');
    ctx.fillStyle = base;
    ctx.fillRect(x0, 0, cw, S);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, cw, S);
    const bg = bump.createLinearGradient(x0, 0, x1, 0);
    bg.addColorStop(0, '#303030');
    bg.addColorStop(0.25, '#b8b8b8');
    bg.addColorStop(0.5, '#e6e6e6');
    bg.addColorStop(0.75, '#b8b8b8');
    bg.addColorStop(1, '#303030');
    bump.fillStyle = bg;
    bump.fillRect(x0, 0, cw, S);

    // length-wise fibre streaks (wrapped in v)
    const nStreak = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < nStreak; i++) {
      ctx.fillStyle = rnd() < 0.6 ? '#5C4028' : '#CDAE80';
      ctx.globalAlpha = 0.06 + rnd() * 0.1;
      const sy = rnd() * S;
      const sl = S * (0.2 + rnd() * 0.6);
      const sx = x0 + cw * (0.2 + rnd() * 0.6);
      const sw = 0.8 + rnd();
      ctx.fillRect(sx, sy, sw, sl);
      if (sy + sl > S) ctx.fillRect(sx, sy - S, sw, sl);
    }
    ctx.globalAlpha = 1;
    // node rings every 7–13"
    let ny = rnd() * 10 * PX;
    while (ny < S - 4) {
      const nh = 2 + rnd() * 2;
      ctx.fillStyle = '#4A321E';
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x0, ny, cw, nh);
      ctx.fillStyle = '#C8A676';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x0, ny + nh, cw, 1.2);
      ctx.globalAlpha = 1;
      bump.fillStyle = '#ffffff';
      bump.globalAlpha = 0.5;
      bump.fillRect(x0 + cw * 0.15, ny - 1, cw * 0.7, nh + 2);
      bump.globalAlpha = 1;
      ny += (7 + rnd() * 6) * PX;
    }
    x += w;
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  const bumpTex = toTexture(bump, false);
  bumpTex.anisotropy = 8;
  return { map, bumpMap: bumpTex };
}

// ---------------------------------------------------------------------------
// Deck boards — 512px == 96" tile, weathered redwood, near-black gaps.
// ---------------------------------------------------------------------------

export function deckWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  // 2048px == one 96" tile (21 px/in): oiled redwood per the deck photos —
  // warm tan where the sun bakes it, richer red-brown in shade, black gaps.
  const S = 2048;
  const rnd = mulberry32(0xdec);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  const rows = 18; // ≈5.3" boards
  const h = S / rows;
  const palette = ['#A26845', '#B0764E', '#8E5A3B', '#9C6A47', '#B98159', '#875234'];

  ctx.fillStyle = '#160e09';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#b4b4b4';
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string; ro: number }[] = [];
    let x = -(120 + rnd() * 900);
    while (x < S) {
      const len = 700 + rnd() * 1000;
      segs.push({ x0: x, x1: x + len, c: palette[(rnd() * palette.length) | 0], ro: 0.55 + rnd() * 0.25 });
      x += len;
    }
    segs[segs.length - 1].c = segs[0].c;
    segs[segs.length - 1].ro = segs[0].ro;
    for (const sg of segs) {
      const w = sg.x1 - sg.x0;
      ctx.fillStyle = sg.c;
      ctx.fillRect(sg.x0, y + 2.6, w - 5, h - 5.2);
      const g = Math.round(sg.ro * 255);
      rough.fillStyle = `rgb(${g},${g},${g})`;
      rough.fillRect(sg.x0, y + 2.6, w - 5, h - 5.2);
      bump.fillStyle = '#8a8a8a';
      bump.fillRect(sg.x0, y + 2.6, w - 5, h - 5.2);

      // grain streaks
      const n = 9 + ((rnd() * 6) | 0);
      for (let i = 0; i < n; i++) {
        const dark = rnd() < 0.7;
        ctx.strokeStyle = dark ? '#5A3520' : '#CE9A6A';
        ctx.globalAlpha = 0.06 + rnd() * 0.11;
        ctx.lineWidth = 1 + rnd() * 2.2;
        const gy = y + 6 + rnd() * (h - 12);
        ctx.beginPath();
        ctx.moveTo(sg.x0 + 6, gy);
        let gx = sg.x0 + 6;
        let cy = gy;
        while (gx < sg.x1 - 10) {
          gx += 120 + rnd() * 180;
          cy = Math.min(y + h - 5, Math.max(y + 5, cy + (rnd() - 0.5) * 7));
          ctx.lineTo(Math.min(gx, sg.x1 - 10), cy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // end joint
      if (sg.x0 > 0 && sg.x0 < S) {
        ctx.fillStyle = '#241209';
        ctx.globalAlpha = 0.7;
        ctx.fillRect(sg.x0 - 2.4, y + 2.6, 4.8, h - 5.2);
        ctx.globalAlpha = 1;
        bump.fillStyle = '#4a4a4a';
        bump.fillRect(sg.x0 - 2.4, y + 2.6, 4.8, h - 5.2);
      }

      // knots
      if (rnd() < 0.35) {
        const kx = sg.x0 + 80 + rnd() * Math.max(60, w - 160);
        const ky = y + h * (0.3 + rnd() * 0.4);
        for (let ring = 0; ring < 4; ring++) {
          ctx.strokeStyle = '#40230F';
          ctx.globalAlpha = 0.3 - ring * 0.06;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.ellipse(kx, ky, 4 + ring * 5, 3 + ring * 3.4, rnd() * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // sun-baked wash patches
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = 'rgba(226,176,124,1)';
        ctx.globalAlpha = 0.04 + rnd() * 0.06;
        ctx.fillRect(sg.x0 + rnd() * w, y + 3, 140 + rnd() * 420, h - 6);
      }
      ctx.globalAlpha = 1;
    }
    // groove between boards reads deep in the bump map
    bump.fillStyle = '#2e2e2e';
    bump.fillRect(0, y + h - 3, S, 5.4);
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  const roughTex = toTexture(rough, false);
  roughTex.anisotropy = 16;
  const bumpTex = toTexture(bump, false);
  bumpTex.anisotropy = 8;
  return { map, roughnessMap: roughTex, bumpMap: bumpTex };
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
// for the facade azimuth (model −z faces true 50°). The venue sits on a hill:
// foreground trees/roofs fall away below the horizon in every direction.
//   NE–E: bay water, Dumbarton Bridge, Fremont hills beyond
//   SE–S: rolling gold-green hills, Stanford (Hoover Tower) in the distance
//   SW–W: closer wooded ridgeline (higher horizon)
//   NW–N: trees and rooftops rolling downhill
// ---------------------------------------------------------------------------

export function bayPanoramaTexture(): THREE.CanvasTexture {
  // 360° backdrop, redrawn for aerial perspective: a hazy blue far ridge,
  // the bay glimpse NE, then three canopy layers that sharpen and saturate
  // as they approach — the venue sits on a knoll above a sea of live oaks.
  const W = 4096;
  const H = 768;
  const ctx = makeCanvas(W, H);
  const rnd = mulberry32(0xba1);
  const HORIZON = H * 0.42;

  ctx.clearRect(0, 0, W, H);

  const trueAzAt = (col: number): number => {
    const th = (col / W) * Math.PI * 2;
    const modelAz = (Math.atan2(Math.sin(th), -Math.cos(th)) * 180) / Math.PI;
    return (((modelAz + 50) % 360) + 360) % 360;
  };
  const sector = (az: number, a0: number, a1: number, feather = 18): number => {
    const inRange = (x: number) => {
      const d0 = ((x - a0 + 540) % 360) - 180;
      const d1 = ((a1 - x + 540) % 360) - 180;
      if (d0 < -feather || d1 < -feather) return 0;
      return Math.min(1, Math.min(d0, d1) / feather + 1);
    };
    return Math.max(0, Math.min(1, inRange(az)));
  };

  // one soft-shaded canopy clump: offset radial gradient fakes top light
  const clump = (x: number, y: number, r: number, lit: string, shade: string, alpha = 1) => {
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.45, r * 0.12, x, y, r);
    g.addColorStop(0, lit);
    g.addColorStop(0.62, shade);
    g.addColorStop(1, shade);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  // 1. far ridge — Santa Cruz mountains W/SW, hazy blue-gray, taller west
  ctx.fillStyle = '#ABB9C8';
  ctx.beginPath();
  ctx.moveTo(0, H);
  const ridgeTops: number[] = [];
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 205, 320, 30);
    const bay = sector(az, 15, 95, 25);
    const y = HORIZON - 20 - west * 100 - Math.sin(x * 0.006) * 12 - Math.sin(x * 0.0016) * 22 * (1 + west) + bay * 40;
    ridgeTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  // ridge haze: fade its base into the sky tone
  const rh = ctx.createLinearGradient(0, HORIZON - 40, 0, HORIZON + 70);
  rh.addColorStop(0, 'rgba(226,231,240,0)');
  rh.addColorStop(1, 'rgba(226,231,240,0.85)');
  ctx.fillStyle = rh;
  ctx.fillRect(0, HORIZON - 40, W, 110);

  // 2. bay water + Dumbarton bridge (NE), pale and hazy
  for (let x = 0; x < W; x++) {
    const az = trueAzAt(x);
    const bay = sector(az, 18, 92, 22);
    if (bay <= 0.02) continue;
    const top = HORIZON + 2;
    const bot = HORIZON + 46;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, `rgba(178,199,209,${0.92 * bay})`);
    g.addColorStop(1, `rgba(159,180,190,${0.85 * bay})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, top, 1.2, bot - top);
    const brid = sector(az, 38, 72, 8);
    if (brid > 0.05) {
      ctx.fillStyle = `rgba(88,96,108,${0.75 * brid})`;
      const by = HORIZON + 18 - Math.max(0, Math.sin((az - 40) / 10) * 3.5);
      ctx.fillRect(x, by, 1.2, 2);
      if (Math.abs(az - 52) < 1 || Math.abs(az - 60) < 1) ctx.fillRect(x, by - 5, 1.2, 5);
    }
  }

  // 3. far canopy shelf — soft, desaturated sage, heavy haze
  const farTops: number[] = [];
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const bay = sector(az, 18, 92, 22);
    const west = sector(az, 200, 325, 35);
    const y = HORIZON + 26 + bay * 30 - west * 26 + Math.sin(x * 0.01 + 2) * 8 + Math.sin(x * 0.003) * 12;
    farTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = '#9AA885';
  ctx.fill();
  for (let i = 0; i < 700; i++) {
    const x = rnd() * W;
    const y = farTops[x | 0] + rnd() * 26;
    clump(x, y, 6 + rnd() * 10, '#AEBB92', '#8B9A78', 0.6);
  }
  ctx.fillStyle = 'rgba(222,230,236,0.42)';
  ctx.fillRect(0, HORIZON, W, H - HORIZON);

  // Stanford cluster + Hoover Tower (true az ~145) on the far shelf
  for (let x = 0; x < W; x++) {
    const az = trueAzAt(x);
    if (Math.abs(az - 145) < 2.6) {
      const y = farTops[x] - 2;
      ctx.fillStyle = '#C4B29A';
      ctx.fillRect(x, y - 5, 1.4, 5);
      if (Math.abs(az - 145) < 0.4) {
        ctx.fillRect(x - 1.5, y - 24, 4, 24);
        ctx.fillStyle = '#9a4f3c';
        ctx.fillRect(x - 2, y - 28, 5, 4.5);
      }
    }
  }

  // 4. mid canopy — olive, clumpier, light haze
  const midTops: number[] = [];
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 205, 320, 30);
    const y = HORIZON + 64 - west * 16 + Math.sin(x * 0.016) * 9 + Math.sin(x * 0.0044) * 14;
    midTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = '#78885E';
  ctx.fill();
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * W;
    const y = midTops[x | 0] + rnd() * 50;
    clump(x, y, 8 + rnd() * 15, '#8C9C68', '#66754C', 0.75);
  }
  // roofs among the mid trees (residential Menlo Park)
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W;
    const az = trueAzAt(x | 0);
    if (sector(az, 320, 200, 30) < 0.3) continue;
    const y = midTops[x | 0] + 14 + rnd() * 40;
    ctx.fillStyle = ['#C9BCA4', '#B4917A', '#D8D2C4', '#98928A'][(rnd() * 4) | 0];
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, 7 + rnd() * 12, 3.5 + rnd() * 3);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(220,228,236,0.2)';
  ctx.fillRect(0, HORIZON + 30, W, H - HORIZON - 30);

  // 5. near canopy — saturated deep olive clumps rolling downhill
  const nearTops: number[] = [];
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 205, 320, 30);
    const y = HORIZON + 128 - west * 10 + Math.sin(x * 0.03) * 10 + Math.sin(x * 0.008) * 16;
    nearTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = '#4E5C3B';
  ctx.fill();
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * W;
    const y = nearTops[x | 0] + rnd() * (H - nearTops[x | 0]);
    clump(x, y, 12 + rnd() * 24, '#69784A', '#415032', 0.85);
  }
  // the white-and-blue neighbor building NE of the deck (photo IMG_5802)
  for (let x = 0; x < W; x++) {
    const az = trueAzAt(x);
    if (Math.abs(az - 30) < 2.4) {
      const y = nearTops[x] + 26;
      ctx.fillStyle = '#E5E7E6';
      ctx.fillRect(x, y, 1.4, 16);
      ctx.fillStyle = '#7E96AC';
      ctx.fillRect(x, y + 3.5, 1.4, 2.4);
    }
  }

  // 6. gentle final haze at the horizon line
  const haze = ctx.createLinearGradient(0, HORIZON - 26, 0, HORIZON + 80);
  haze.addColorStop(0, 'rgba(224,231,239,0.5)');
  haze.addColorStop(1, 'rgba(224,231,239,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, HORIZON - 26, W, 106);

  const t = new THREE.CanvasTexture(ctx.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// Plank pavers — the covered entry walk's linear concrete planks (photos:
// mixed cream/greige/gray/tan strips running along the walk).
// ---------------------------------------------------------------------------

export function plankPaverTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 1024; // one 96" tile
  const rnd = mulberry32(0x9aef);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S); // sand joints sit just below the plank faces
  bump.fillStyle = '#9a9a9a';
  bump.fillRect(0, 0, S, S);
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
        bump.fillStyle = '#303030';
        bump.fillRect(x + 1, sg.y0 - 1, w - 2, 2);
      }
      // slight per-plank lippage
      bump.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      bump.fillRect(x + 1, sg.y0 + 1, w - 2, sg.y1 - sg.y0 - 2);
    }
    // column joint
    ctx.fillStyle = 'rgba(74,70,62,0.55)';
    ctx.fillRect(x + w - 1, 0, 1.4, S);
    rough.fillStyle = '#e0e0e0';
    rough.fillRect(x + w - 1, 0, 1.4, S);
    bump.fillStyle = '#303030';
    bump.fillRect(x + w - 1.2, 0, 1.8, S);
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  const bumpMap = toTexture(bump, false);
  bumpMap.anisotropy = 8;
  return { map, roughnessMap: toTexture(rough, false), bumpMap };
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
// Live-oak bark — dark, deeply fissured; v runs along the limb.
// ---------------------------------------------------------------------------

export function barkTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const rnd = mulberry32(0xbaa2);
  const ctx = makeCanvas(W, H);
  ctx.fillStyle = '#3A332C';
  ctx.fillRect(0, 0, W, H);
  // vertical fissure ridges
  for (let i = 0; i < 46; i++) {
    let x = rnd() * W;
    const light = rnd() < 0.55;
    ctx.strokeStyle = light ? '#4C443A' : '#211C17';
    ctx.lineWidth = 2 + rnd() * 5;
    ctx.globalAlpha = 0.5 + rnd() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, -8);
    for (let y = 0; y <= H + 8; y += 26) {
      x += (rnd() - 0.5) * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // horizontal checking cracks
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = '#241F1A';
    ctx.globalAlpha = 0.25 + rnd() * 0.3;
    ctx.lineWidth = 1 + rnd();
    const y = rnd() * H;
    const x = rnd() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 + rnd() * 18, y + (rnd() - 0.5) * 6);
    ctx.stroke();
  }
  // lichen dust
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#5C594A' : '#4A4B40';
    ctx.globalAlpha = 0.1 + rnd() * 0.16;
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, 1 + rnd() * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = toTexture(ctx, true);
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Near treetop ring — an alpha-cut band of canopy encircling the knoll just
// beyond the deck, for parallax between the railing and the painted valley.
// ---------------------------------------------------------------------------

export function treetopRingTexture(): THREE.CanvasTexture {
  const W = 4096;
  const H = 512;
  const rnd = mulberry32(0x7ee7);
  const ctx = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  const clump = (x: number, y: number, r: number, lit: string, shade: string) => {
    const g = ctx.createRadialGradient(x - r * 0.22, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, lit);
    g.addColorStop(0.6, shade);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // the deck OVERLOOKS the canopy: most crowns sit low in the band, with a
  // few tall groups breaking the line — fine clumps, lots of texture
  let x = 0;
  while (x < W) {
    const groupW = 120 + rnd() * 300;
    const tall = rnd() < 0.22;
    const crownTop = H * (tall ? 0.3 + rnd() * 0.14 : 0.56 + rnd() * 0.2);
    const n = 8 + ((rnd() * 8) | 0);
    for (let i = 0; i < n; i++) {
      const cx = x + rnd() * groupW;
      const cy = crownTop + rnd() * (H * 0.28);
      const r = 15 + rnd() * 22;
      const dark = rnd() < 0.45;
      clump(
        cx,
        Math.max(cy, r * 0.7),
        r,
        dark ? '#5E6E44' : '#71814E',
        dark ? '#3C4A2F' : '#4A5839',
      );
    }
    x += groupW + 20 + rnd() * 130;
  }
  // solid base below the crown line
  const baseGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
  baseGrad.addColorStop(0, 'rgba(56,67,43,0)');
  baseGrad.addColorStop(0.4, 'rgba(56,67,43,0.92)');
  baseGrad.addColorStop(1, 'rgba(47,57,37,1)');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  // gentle aerial haze over the whole band so it recedes behind the railing
  ctx.fillStyle = 'rgba(214,224,230,0.16)';
  ctx.fillRect(0, 0, W, H);

  const t = new THREE.CanvasTexture(ctx.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

