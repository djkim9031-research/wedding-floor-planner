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

export function deckWoodTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const S = 1024; // 1024px == one 96" tile -> ~10.7 px/inch, same class as the interior floor
  const rnd = mulberry32(0xdec);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const rows = 18; // ≈5.3" boards
  const h = S / rows;
  // oiled redwood per the deck photos: warm, saturated red-brown
  const palette = ['#A0603F', '#96573A', '#AB6B48', '#8B4E33', '#A26443'];

  ctx.fillStyle = '#1d120c';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#b4b4b4'; // gaps read matte
  rough.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const segs: { x0: number; x1: number; c: string; ro: number }[] = [];
    let x = -(80 + rnd() * 520);
    while (x < S) {
      const len = 360 + rnd() * 480;
      segs.push({
        x0: x,
        x1: x + len,
        c: palette[(rnd() * palette.length) | 0],
        ro: 0.62 + rnd() * 0.24,
      });
      x += len;
    }
    segs[segs.length - 1].c = segs[0].c; // seam wrap
    segs[segs.length - 1].ro = segs[0].ro;
    for (const sg of segs) {
      ctx.fillStyle = sg.c;
      ctx.fillRect(sg.x0, y + 1.4, sg.x1 - sg.x0 - 2.6, h - 2.8);
      const g = Math.round(sg.ro * 255);
      rough.fillStyle = `rgb(${g},${g},${g})`;
      rough.fillRect(sg.x0, y + 1.4, sg.x1 - sg.x0 - 2.6, h - 2.8);

      // long grain streaks, board-length like the interior floor
      const n = 4 + ((rnd() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const dark = rnd() < 0.72;
        ctx.strokeStyle = dark ? '#5C3520' : '#C88B60';
        ctx.globalAlpha = 0.06 + rnd() * 0.12;
        ctx.lineWidth = 0.8 + rnd() * 1.6;
        const gy = y + 4 + rnd() * (h - 8);
        ctx.beginPath();
        ctx.moveTo(sg.x0 + 4, gy);
        let gx = sg.x0 + 4;
        let cy = gy;
        while (gx < sg.x1 - 6) {
          gx += 70 + rnd() * 90;
          cy = Math.min(y + h - 3, Math.max(y + 3, cy + (rnd() - 0.5) * 4));
          ctx.lineTo(Math.min(gx, sg.x1 - 6), cy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // end joint between boards
      if (sg.x0 > 0 && sg.x0 < S) {
        ctx.fillStyle = '#3A2114';
        ctx.globalAlpha = 0.5;
        ctx.fillRect(sg.x0 - 1.4, y + 1.4, 2.8, h - 2.8);
        ctx.globalAlpha = 1;
      }

      // occasional knot
      if (rnd() < 0.3) {
        const kx = sg.x0 + 40 + rnd() * Math.max(40, sg.x1 - sg.x0 - 80);
        const ky = y + h * (0.3 + rnd() * 0.4);
        for (let ring = 0; ring < 3; ring++) {
          ctx.strokeStyle = '#4A2A18';
          ctx.globalAlpha = 0.24 - ring * 0.06;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.ellipse(kx, ky, 3 + ring * 3, 2 + ring * 2, rnd(), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // sun-warmed smears
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(222,176,130,1)';
      ctx.globalAlpha = 0.03 + rnd() * 0.05;
      ctx.fillRect(rnd() * S, y + 2, 60 + rnd() * 180, h - 4);
    }
    ctx.globalAlpha = 1;
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  const roughTex = toTexture(rough, false);
  roughTex.anisotropy = 16;
  return { map, roughnessMap: roughTex };
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
  const W = 2048;
  const H = 512;
  const ctx = makeCanvas(W, H);
  const rnd = mulberry32(0xba1);
  const HORIZON = H * 0.42;

  ctx.clearRect(0, 0, W, H);

  const trueAzAt = (col: number): number => {
    const th = (col / W) * Math.PI * 2;
    const modelAz = (Math.atan2(Math.sin(th), -Math.cos(th)) * 180) / Math.PI;
    return (((modelAz + 50) % 360) + 360) % 360;
  };
  // sector weight with soft edges (degrees)
  const sector = (az: number, a0: number, a1: number, feather = 18): number => {
    const inRange = (x: number) => {
      const d0 = ((x - a0 + 540) % 360) - 180;
      const d1 = ((a1 - x + 540) % 360) - 180;
      if (d0 < -feather || d1 < -feather) return 0;
      return Math.min(1, Math.min(d0, d1) / feather + 1);
    };
    return Math.max(0, Math.min(1, inRange(az)));
  };

  const smooth: number[] = [];
  for (let x = 0; x < W; x++) smooth.push(rnd());

  // 1. far ridge (hazy) — higher & closer toward the west
  ctx.fillStyle = '#a3b2c0';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 205, 320, 30);
    const bay = sector(az, 15, 95, 25);
    const base = HORIZON - 14 - west * 66 - Math.sin(x * 0.012) * 8 - Math.sin(x * 0.0031) * 14 * (1 + west);
    ctx.lineTo(x, base + bay * 26); // ridge sits lower behind the bay
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // 2. bay water + Dumbarton Bridge (NE–E)
  for (let x = 0; x < W; x++) {
    const az = trueAzAt(x);
    const bay = sector(az, 18, 92, 22);
    if (bay <= 0.02) continue;
    const top = HORIZON + 4;
    const bot = HORIZON + 34;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, `rgba(168,191,201,${0.9 * bay})`);
    g.addColorStop(1, `rgba(150,172,182,${0.85 * bay})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, top, 1.2, bot - top);
    // bridge line with low truss humps mid-bay
    const brid = sector(az, 38, 72, 8);
    if (brid > 0.05) {
      ctx.fillStyle = `rgba(74,82,94,${0.9 * brid})`;
      const by = HORIZON + 13 - Math.max(0, Math.sin((az - 40) / 10) * 2.5);
      ctx.fillRect(x, by, 1.2, 1.6);
      if (Math.abs(az - 52) < 1.2 || Math.abs(az - 60) < 1.2) {
        ctx.fillRect(x, by - 4, 1.2, 4); // truss towers
      }
    }
  }

  // 3. mid rolling hills (gold-green, more gold to the south)
  ctx.beginPath();
  ctx.moveTo(0, H);
  const midTops: number[] = [];
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 200, 325, 35);
    const bay = sector(az, 18, 92, 22);
    const y =
      HORIZON +
      18 +
      bay * 22 -
      west * 20 +
      Math.sin(x * 0.02 + 2) * 6 +
      Math.sin(x * 0.0055) * 10;
    midTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  const midGrad = ctx.createLinearGradient(0, HORIZON, 0, H);
  midGrad.addColorStop(0, '#93a276');
  midGrad.addColorStop(1, '#7c8d63');
  ctx.fillStyle = midGrad;
  ctx.fill();

  // Stanford cluster + Hoover Tower (true az ~145)
  for (let x = 0; x < W; x++) {
    const az = trueAzAt(x);
    if (Math.abs(az - 145) < 3.2) {
      const y = midTops[x] - 2;
      ctx.fillStyle = '#b8a58c';
      ctx.fillRect(x, y - 3.5, 1.4, 3.5);
      if (Math.abs(az - 145) < 0.5) {
        ctx.fillRect(x - 1, y - 15, 3, 15); // Hoover Tower
        ctx.fillStyle = '#9a4f3c';
        ctx.fillRect(x - 1.4, y - 17.5, 3.8, 3);
      }
    }
  }

  // 4. near treetops + rooftops falling away downhill
  ctx.beginPath();
  ctx.moveTo(0, H);
  const treeTops: number[] = [];
  for (let x = 0; x <= W; x++) {
    const az = trueAzAt(x);
    const west = sector(az, 205, 320, 30);
    const n = smooth[(x / 6) | 0] ?? 0.5;
    const y = HORIZON + 44 - west * 12 + Math.sin(x * 0.06) * 5 + n * 14;
    treeTops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  const treeGrad = ctx.createLinearGradient(0, HORIZON + 20, 0, H);
  treeGrad.addColorStop(0, '#57683f');
  treeGrad.addColorStop(1, '#3c4a2e');
  ctx.fillStyle = treeGrad;
  ctx.fill();
  // canopy scallops + rooftop speckles between the trees
  for (let i = 0; i < 900; i++) {
    const x = (rnd() * W) | 0;
    const az = trueAzAt(x);
    const y = treeTops[x] + rnd() * (H - treeTops[x]) * 0.6;
    if (rnd() < 0.24 && sector(az, 320, 200, 30) > 0.3) {
      ctx.fillStyle = rnd() < 0.5 ? '#b4917a' : '#cfc5b2'; // roofs among the trees
      ctx.fillRect(x, y, 5 + rnd() * 7, 2.5 + rnd() * 2);
    } else {
      ctx.fillStyle = rnd() < 0.5 ? '#4a5a3c' : '#33402a';
      ctx.beginPath();
      ctx.arc(x, y, 3 + rnd() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 5. haze wash toward the horizon line
  const haze = ctx.createLinearGradient(0, HORIZON - 30, 0, HORIZON + 60);
  haze.addColorStop(0, 'rgba(220,228,236,0.55)');
  haze.addColorStop(1, 'rgba(220,228,236,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, HORIZON - 30, W, 90);

  const t = new THREE.CanvasTexture(ctx.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}
