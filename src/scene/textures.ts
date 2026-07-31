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
// Hardwood floor — 1024px == one 128" tile (8 px/inch), ~5" planks along v.
// ---------------------------------------------------------------------------

export function floorWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const S = 1024;
  const rnd = mulberry32(0xf100d);
  const cols = 26; // 1024/26 ≈ 39.4px ≈ 5" planks, integer count keeps the tile seamless
  const w = S / cols;
  const palette = ['#A97545', '#B98753', '#C08E5C', '#9E6C3E'];

  interface Board {
    y0: number;
    y1: number;
    color: string;
    rough: number;
  }
  const layout: Board[][] = [];
  for (let c = 0; c < cols; c++) {
    const boards: Board[] = [];
    let y = -(60 + rnd() * 600);
    while (y < S) {
      const len = 240 + rnd() * 480; // 30–90" boards
      boards.push({
        y0: y,
        y1: y + len,
        color: palette[(rnd() * palette.length) | 0],
        rough: 0.42 + rnd() * 0.2,
      });
      y += len;
    }
    // first and last board straddle the tile seam — matching them hides it
    boards[0].color = boards[boards.length - 1].color;
    boards[0].rough = boards[boards.length - 1].rough;
    layout.push(boards);
  }

  const map = makeCanvas(S, S);
  map.fillStyle = '#B07E4C';
  map.fillRect(0, 0, S, S);
  const rough = makeCanvas(S, S);
  rough.fillStyle = '#808080';
  rough.fillRect(0, 0, S, S);

  layout.forEach((boards, c) => {
    const x0 = c * w;
    for (const bd of boards) {
      map.globalAlpha = 0.92;
      map.fillStyle = bd.color;
      map.fillRect(x0, bd.y0, w, bd.y1 - bd.y0);
      map.globalAlpha = 1;

      const g = Math.round(bd.rough * 255);
      rough.fillStyle = `rgb(${g},${g},${g})`;
      rough.fillRect(x0, bd.y0, w, bd.y1 - bd.y0);

      // grain streaks
      const n = Math.max(2, ((bd.y1 - bd.y0) / 110) | 0);
      for (let i = 0; i < n; i++) {
        const dark = rnd() < 0.7;
        map.strokeStyle = dark ? '#7A5230' : '#D8A96C';
        map.globalAlpha = 0.04 + rnd() * 0.08;
        map.lineWidth = 0.7 + rnd() * 1.5;
        map.beginPath();
        let sx = x0 + 3 + rnd() * (w - 6);
        let sy = bd.y0 + rnd() * 40;
        map.moveTo(sx, sy);
        const ey = bd.y1 - rnd() * 30;
        while (sy < ey) {
          sy += 45 + rnd() * 60;
          sx = Math.min(x0 + w - 2, Math.max(x0 + 2, sx + (rnd() - 0.5) * 5));
          map.lineTo(sx, Math.min(sy, ey));
        }
        map.stroke();
      }
      map.globalAlpha = 1;

      // end joint
      if (bd.y0 > 0 && bd.y0 < S) {
        map.fillStyle = '#6E4526';
        map.globalAlpha = 0.38;
        map.fillRect(x0, bd.y0 - 1, w, 2);
        map.globalAlpha = 1;
        rough.fillStyle = '#9E9E9E';
        rough.fillRect(x0, bd.y0 - 1, w, 2);
      }
    }
    // plank gap + milled edge highlight (soft: hairline contrast shimmers
    // under minification on weak anisotropic filters)
    map.fillStyle = '#6E4526';
    map.globalAlpha = 0.3;
    map.fillRect(x0 + w - 1.25, 0, 1.5, S);
    map.globalAlpha = 0.07;
    map.fillStyle = '#E8C089';
    map.fillRect(x0, 0, 1.5, S);
    map.globalAlpha = 1;
    rough.fillStyle = '#9E9E9E'; // 0.62 — gaps read matte
    rough.fillRect(x0 + w - 1, 0, 1, S);
  });

  const mapTex = toTexture(map, true);
  mapTex.anisotropy = 16;
  return { map: mapTex, roughnessMap: toTexture(rough, false) };
}

// ---------------------------------------------------------------------------
// Reed/bamboo ceiling — 512px == 64", 2" reeds along v (reed axis maps to z).
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
// Deck boards — 512px == 96" tile, weathered redwood, near-black gaps.
// ---------------------------------------------------------------------------

export function deckWoodTexture(): THREE.CanvasTexture {
  const S = 512;
  const rnd = mulberry32(0xdec);
  const ctx = makeCanvas(S, S);
  const rows = 18; // ≈5.3" boards
  const h = S / rows;
  // oiled redwood per the deck photos: warm, saturated red-brown
  const palette = ['#A0603F', '#96573A', '#AB6B48', '#8B4E33', '#A26443'];

  ctx.fillStyle = '#17100B';
  ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string }[] = [];
    let x = -(40 + rnd() * 260);
    while (x < S) {
      const len = 180 + rnd() * 240;
      segs.push({ x0: x, x1: x + len, c: palette[(rnd() * palette.length) | 0] });
      x += len;
    }
    segs[segs.length - 1].c = segs[0].c; // seam wrap
    for (const s of segs) {
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x0, y + 0.8, s.x1 - s.x0 - 1.6, h - 1.6);
      // grain
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = '#4A2E1D';
        ctx.globalAlpha = 0.09 + rnd() * 0.1;
        ctx.lineWidth = 0.7 + rnd();
        const gy = y + 3 + rnd() * (h - 6);
        ctx.beginPath();
        ctx.moveTo(s.x0 + 3, gy);
        ctx.lineTo(s.x1 - 4, gy + (rnd() - 0.5) * 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // sun-warmed smears
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(222,176,130,1)';
      ctx.globalAlpha = 0.03 + rnd() * 0.05;
      ctx.fillRect(rnd() * S, y + 1, 30 + rnd() * 90, h - 2);
    }
    ctx.globalAlpha = 1;
  }
  const deckTex = toTexture(ctx, true);
  deckTex.anisotropy = 16;
  return deckTex;
}

// ---------------------------------------------------------------------------
// Oak tabletop — slightly-orange oak with wavy grain, plus matching bump.
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
  const W = 64;
  const H = 512;
  const ctx = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#BFD8F2');
  g.addColorStop(0.55, '#CFDCEA');
  g.addColorStop(0.82, '#E2DBCE');
  g.addColorStop(1, '#EAD9C0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const t = toTexture(ctx, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Valley backdrop — hazy banded hillside with two scalloped oak-canopy rows;
// haze is baked in and the top edge fades to alpha so it melts into the sky.
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
