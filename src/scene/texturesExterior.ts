import * as THREE from 'three';

// Procedural textures for the exterior: Ipe deck + rail, tree bark and leaf
// cluster atlases, deck litter, asphalt, slope ground, the trailer siding,
// and the two backdrop bands (bay panorama, treetop ring). Canvas-generated
// and seeded like the rest of the app (single-file build: no assets).

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
  return c.getContext('2d', { willReadFrequently: true })!;
}

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}


/** Tangent-space normal map from a grayscale height canvas (tiling). Canvas
 * row 0 is the texture's top (flipY), so +v runs up the canvas. */
function heightToNormal(h: CanvasRenderingContext2D, strength: number): THREE.CanvasTexture {
  const W = h.canvas.width;
  const H = h.canvas.height;
  const src = h.getImageData(0, 0, W, H).data;
  const out = makeCanvas(W, H);
  const img = out.createImageData(W, H);
  const d = img.data;
  const at = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength; // +v is up the canvas
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const k = (y * W + x) * 4;
      d[k] = (-dx * inv * 0.5 + 0.5) * 255;
      d[k + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[k + 2] = (inv * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  out.putImageData(img, 0, 0);
  return toTexture(out, false);
}

/** Alpha-cut RGBA canvas → DataTexture with the colour of transparent texels
 * replaced by the mean opaque colour, so mipmaps and bilinear filtering don't
 * pull dark fringes into alpha-tested leaves (a canvas drops the colour of
 * fully transparent pixels). Rows are flipped so canvas-top = v 1. */
function alphaCutTexture(ctx: CanvasRenderingContext2D): THREE.DataTexture {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const src = ctx.getImageData(0, 0, W, H).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let k = 0; k < src.length; k += 4) {
    if (src[k + 3] > 128) {
      r += src[k];
      g += src[k + 1];
      b += src[k + 2];
      n++;
    }
  }
  n = Math.max(1, n);
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const s = (sy * W + x) * 4;
      const o = (y * W + x) * 4;
      const a = src[s + 3];
      // edge texels keep their own colour; fully clear ones take the mean
      const w = a / 255;
      data[o] = src[s] * w + (r / n) * (1 - w);
      data[o + 1] = src[s + 1] * w + (g / n) * (1 - w);
      data[o + 2] = src[s + 2] * w + (b / n) * (1 - w);
      data[o + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Ipe deck — 2048² tile = 192" along the boards (u, E-W) × 96" across (v):
// 26 rows of 3.5" boards on 3/16" gaps, oiled deep red-brown, board-to-board
// colour variation, fine interlocked grain, butt joints staggered.
// ---------------------------------------------------------------------------

export const DECK_TILE_U_IN = 192;
export const DECK_TILE_V_IN = 96;

export function deckIpeTextures(): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const S = 2048;
  const rows = 26;
  const rowH = S / rows; // 78.8 px = 3.69"
  const pxV = S / DECK_TILE_V_IN; // 21.3 px/in across
  const pxU = S / DECK_TILE_U_IN; // 10.7 px/in along
  const gap = 0.1875 * pxV; // 4 px
  const rnd = mulberry32(0x1be);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  const bump = makeCanvas(S, S);
  // oiled Ipe: brick-red to chocolate, a few lighter amber boards
  const palette = ['#7C4230', '#86472F', '#6D3826', '#914F36', '#743E2B', '#63321F', '#9A583B', '#7F4127', '#6A3A2A', '#8C4A2E'];

  ctx.fillStyle = '#120a07';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#d0d0d0';
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#000000';
  bump.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH + gap / 2;
    const bh = rowH - gap;
    // periodic joint layout along u
    const joints: number[] = [];
    let x = rnd() * S;
    const start = x;
    joints.push(x);
    for (;;) {
      const len = (70 + rnd() * 120) * pxU; // 6'–16' boards
      if (x + len >= start + S - 36 * pxU) break;
      x += len;
      joints.push(x);
    }
    joints.push(start + S);
    for (let j = 0; j < joints.length - 1; j++) {
      const a = joints[j] + 1;
      const b = joints[j + 1] - 1;
      const col = palette[(rnd() * palette.length) | 0];
      const tone = 0.9 + rnd() * 0.2;
      const ro = 0.3 + rnd() * 0.12;
      for (const off of [0, -S]) {
        const x0 = a + off;
        const x1 = b + off;
        if (x1 < 0 || x0 > S) continue;
        const w = x1 - x0;
        ctx.fillStyle = col;
        ctx.fillRect(x0, y0, w, bh);
        // gentle along-board value drift (oil soaked unevenly)
        const drift = ctx.createLinearGradient(x0, 0, x1, 0);
        drift.addColorStop(0, `rgba(0,0,0,${0.08 * (1 - tone)})`);
        drift.addColorStop(0.5, `rgba(255,190,140,${0.05 * (tone - 0.9)})`);
        drift.addColorStop(1, `rgba(0,0,0,${0.06 * rnd()})`);
        ctx.fillStyle = drift;
        ctx.fillRect(x0, y0, w, bh);
        const g = Math.round(ro * 255);
        rough.fillStyle = `rgb(${g},${g},${g})`;
        rough.fillRect(x0, y0, w, bh);
        // board height: flat top with eased (rounded) long edges
        const e = 3;
        const bg = bump.createLinearGradient(0, y0, 0, y0 + bh);
        bg.addColorStop(0, '#6a6a6a');
        bg.addColorStop(e / bh, '#c8c8c8');
        bg.addColorStop(1 - e / bh, '#c8c8c8');
        bg.addColorStop(1, '#6a6a6a');
        bump.fillStyle = bg;
        bump.fillRect(x0, y0, w, bh);
        // eased ends
        bump.fillStyle = 'rgba(0,0,0,0.35)';
        bump.fillRect(x0, y0, 2, bh);
        bump.fillRect(x1 - 2, y0, 2, bh);
      }
      // grain: long fine streaks, interlocked (subtle alternating bands)
      const n = 16 + ((rnd() * 10) | 0);
      for (let i = 0; i < n; i++) {
        const dark = rnd() < 0.62;
        const alpha = 0.05 + rnd() * 0.1;
        const lw = 0.8 + rnd() * 1.8;
        const gy = y0 + 3 + rnd() * (bh - 6);
        const phase = rnd() * 6.28;
        const amp = 1 + rnd() * 2.5;
        for (const off of [0, -S]) {
          const x0 = a + off;
          const x1 = b + off;
          if (x1 < 0 || x0 > S) continue;
          ctx.strokeStyle = dark ? '#3E1C10' : '#B77552';
          ctx.globalAlpha = alpha;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (let gx = x0; gx <= x1; gx += 24) {
            const yy = gy + Math.sin(gx * 0.004 + phase) * amp;
            if (gx === x0) ctx.moveTo(gx, yy);
            else ctx.lineTo(gx, yy);
          }
          ctx.stroke();
          rough.strokeStyle = dark ? '#b0b0b0' : '#707070';
          rough.globalAlpha = alpha;
          rough.lineWidth = lw;
          rough.beginPath();
          rough.moveTo(x0, gy);
          rough.lineTo(x1, gy);
          rough.stroke();
        }
      }
      ctx.globalAlpha = 1;
      rough.globalAlpha = 1;
      // occasional pin knots / mineral streaks (Ipe has few knots)
      if (rnd() < 0.22) {
        const kx = a + rnd() * (b - a);
        const ky = y0 + bh * (0.25 + rnd() * 0.5);
        for (const off of [0, -S]) {
          ctx.fillStyle = 'rgba(40,16,8,0.35)';
          ctx.beginPath();
          ctx.ellipse(kx + off, ky, 10 + rnd() * 18, 2 + rnd() * 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // water marks / sun-faded ends: soft lighter smudges
      for (let i = 0; i < 3; i++) {
        const sx = a + rnd() * (b - a);
        const sw = (8 + rnd() * 30) * pxU;
        for (const off of [0, -S]) {
          ctx.fillStyle = `rgba(190,120,84,${0.04 + rnd() * 0.05})`;
          ctx.fillRect(sx + off, y0, sw, bh);
        }
      }
    }
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 16;
  const roughTex = toTexture(rough, false);
  roughTex.anisotropy = 16;
  const bumpTex = toTexture(bump, false);
  bumpTex.anisotropy = 8;
  const normalMap = heightToNormal(bump, 3.2);
  normalMap.anisotropy = 16;
  return { map, roughnessMap: roughTex, bumpMap: bumpTex, normalMap };
}

// ---------------------------------------------------------------------------
// Ipe rail stock (posts, cap rail, fascia): 1024×256 = 64" along the grain
// (u) × 16" across (v). Map geometry so the grain runs along each piece.
// ---------------------------------------------------------------------------

export const RAIL_TILE_U_IN = 64;
export const RAIL_TILE_V_IN = 16;

export function ipeRailTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const W = 1024;
  const H = 256;
  const rnd = mulberry32(0x5a11);
  const ctx = makeCanvas(W, H);
  const bump = makeCanvas(W, H);
  ctx.fillStyle = '#6B3726';
  ctx.fillRect(0, 0, W, H);
  bump.fillStyle = '#808080';
  bump.fillRect(0, 0, W, H);
  // broad colour bands (different boards glued/milled)
  for (let i = 0; i < 6; i++) {
    const y = rnd() * H;
    const h = 20 + rnd() * 60;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,16,8,0.18)' : 'rgba(170,96,60,0.14)';
    ctx.fillRect(0, y, W, h);
    ctx.fillRect(0, y - H, W, h);
  }
  for (let i = 0; i < 140; i++) {
    const dark = rnd() < 0.6;
    const y = rnd() * H;
    const amp = 1 + rnd() * 4;
    const ph = rnd() * 6.28;
    const lw = 0.6 + rnd() * 1.6;
    ctx.strokeStyle = dark ? '#34150B' : '#B06E4C';
    ctx.globalAlpha = 0.06 + rnd() * 0.12;
    ctx.lineWidth = lw;
    bump.strokeStyle = dark ? '#6a6a6a' : '#949494';
    bump.globalAlpha = 0.5;
    bump.lineWidth = lw;
    for (const c of [ctx, bump]) {
      c.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const yy = y + Math.sin((x / W) * Math.PI * 2 * 2 + ph) * amp;
        if (x === 0) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();
    }
  }
  ctx.globalAlpha = 1;
  bump.globalAlpha = 1;
  const map = toTexture(ctx, true);
  map.anisotropy = 8;
  const normalMap = heightToNormal(bump, 1.2);
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// Bark — 512×1024 tiles; u wraps around the stem (tile width in inches of
// circumference below), v runs along it.
// ---------------------------------------------------------------------------

export type BarkKind = 'oak' | 'pine' | 'eucalyptus' | 'olive' | 'crape';

/** inches of circumference × inches of length covered by one bark tile */
export const BARK_TILE_IN: Record<BarkKind, [number, number]> = {
  oak: [30, 60],
  pine: [30, 60],
  eucalyptus: [36, 90],
  olive: [20, 40],
  crape: [16, 40],
};

export function barkTextures(kind: BarkKind): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const W = 512;
  const H = 1024;
  const rnd = mulberry32({ oak: 0xba4c, pine: 0x914e, eucalyptus: 0xe0ca, olive: 0x011e, crape: 0xc4a9 }[kind]);
  const ctx = makeCanvas(W, H);
  const h = makeCanvas(W, H);
  const wrapStroke = (c: CanvasRenderingContext2D, draw: (dx: number) => void) => {
    for (const dx of [-W, 0, W]) draw(dx);
    void c;
  };

  if (kind === 'oak' || kind === 'olive') {
    // coast live oak: grey-brown, blocky furrows, lichen-mottled
    const base = kind === 'oak' ? '#524D47' : '#6E6962';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    h.fillStyle = '#b0b0b0';
    h.fillRect(0, 0, W, H);
    // plate tonal variation
    for (let i = 0; i < 220; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const rw = 10 + rnd() * 40;
      const rh = 30 + rnd() * 90;
      const l = rnd();
      ctx.fillStyle = l < 0.5 ? `rgba(40,34,30,${0.1 + rnd() * 0.15})` : `rgba(140,132,120,${0.08 + rnd() * 0.12})`;
      wrapStroke(ctx, (dx) => {
        ctx.beginPath();
        ctx.ellipse(x + dx, y, rw, rh, (rnd() - 0.5) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // vertical furrows, wavy and anastomosing
    const nF = kind === 'oak' ? 30 : 22;
    for (let i = 0; i < nF; i++) {
      let x = rnd() * W;
      const lw = 3 + rnd() * 7;
      const pts: [number, number][] = [];
      for (let y = -20; y <= H + 20; y += 18) {
        x += (rnd() - 0.5) * 12;
        pts.push([x, y]);
      }
      for (const [c, col, w] of [
        [ctx, '#221C18', lw],
        [h, '#101010', lw * 1.3],
      ] as const) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.globalAlpha = 0.75;
        wrapStroke(c, (dx) => {
          c.beginPath();
          pts.forEach(([px, py], k) => (k ? c.lineTo(px + dx, py) : c.moveTo(px + dx, py)));
          c.stroke();
        });
      }
    }
    // cross checks breaking the ridges into plates
    for (let i = 0; i < 160; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const len = 8 + rnd() * 20;
      for (const [c, col] of [
        [ctx, '#2A231E'],
        [h, '#303030'],
      ] as const) {
        c.strokeStyle = col;
        c.lineWidth = 1.5 + rnd() * 2;
        c.globalAlpha = 0.6;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + len, y + (rnd() - 0.5) * 8);
        c.stroke();
      }
    }
    ctx.globalAlpha = 1;
    h.globalAlpha = 1;
    // lichen: pale grey-green crusts and a few yellow-orange specks
    for (let i = 0; i < (kind === 'oak' ? 300 : 160); i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 3 + rnd() * rnd() * 16;
      const c = rnd();
      ctx.fillStyle = c < 0.55 ? '#83867A' : c < 0.85 ? '#96988C' : c < 0.95 ? '#6E7464' : '#9A8A5C';
      ctx.globalAlpha = 0.12 + rnd() * 0.24;
      wrapStroke(ctx, (dx) => {
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          ctx.moveTo(x + dx + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r);
          ctx.arc(x + dx + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * (0.3 + rnd() * 0.5), 0, Math.PI * 2);
        }
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'pine') {
    // Italian stone pine: orange-brown plates split by dark fissures
    ctx.fillStyle = '#3A2519';
    ctx.fillRect(0, 0, W, H);
    h.fillStyle = '#202020';
    h.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const pw = 16 + rnd() * 34;
      const ph = 30 + rnd() * 70;
      const cols = ['#8A5238', '#9C6243', '#7A4630', '#A87150', '#6E4A3A', '#8E7462'];
      ctx.fillStyle = cols[(rnd() * cols.length) | 0];
      h.fillStyle = `rgb(${150 + rnd() * 80},${150 + rnd() * 80},${150 + rnd() * 80})`;
      const verts: [number, number][] = [];
      const n = 5 + ((rnd() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        verts.push([Math.cos(a) * pw * (0.7 + rnd() * 0.3), Math.sin(a) * ph * (0.7 + rnd() * 0.3)]);
      }
      for (const c of [ctx, h]) {
        wrapStroke(c, (dx) => {
          c.beginPath();
          verts.forEach(([vx, vy], k) => (k ? c.lineTo(x + dx + vx, y + vy) : c.moveTo(x + dx + vx, y + vy)));
          c.closePath();
          c.fill();
        });
      }
    }
    // grey weathered film over the plates
    ctx.fillStyle = 'rgba(120,112,104,0.18)';
    ctx.fillRect(0, 0, W, H);
  } else if (kind === 'eucalyptus') {
    // smooth, pale cream-grey with shed patches and long streaks
    ctx.fillStyle = '#CFC8B8';
    ctx.fillRect(0, 0, W, H);
    h.fillStyle = '#909090';
    h.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const cols = ['#B7AE9C', '#A89E8C', '#DCD6C8', '#C0B7A2', '#9DA096', '#D9CCB0'];
      ctx.fillStyle = cols[(rnd() * cols.length) | 0];
      ctx.globalAlpha = 0.5 + rnd() * 0.4;
      const rw = 20 + rnd() * 70;
      const rh = 40 + rnd() * 160;
      wrapStroke(ctx, (dx) => {
        ctx.beginPath();
        ctx.ellipse(x + dx, y, rw, rh, (rnd() - 0.5) * 0.2, 0, Math.PI * 2);
        ctx.fill();
      });
      h.fillStyle = `rgba(${rnd() < 0.5 ? 160 : 110},0,0,0.3)`;
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W;
      ctx.strokeStyle = rnd() < 0.5 ? '#9E9484' : '#E2DCCE';
      ctx.globalAlpha = 0.15 + rnd() * 0.2;
      ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rnd() - 0.5) * 20, H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    // crape myrtle: smooth mottled tan / grey / cinnamon
    ctx.fillStyle = '#B3A18A';
    ctx.fillRect(0, 0, W, H);
    h.fillStyle = '#808080';
    h.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const cols = ['#9C8468', '#C7B8A2', '#8E8A80', '#A77B5A', '#D1C6B4'];
      ctx.fillStyle = cols[(rnd() * cols.length) | 0];
      ctx.globalAlpha = 0.6;
      wrapStroke(ctx, (dx) => {
        ctx.beginPath();
        ctx.ellipse(x + dx, y, 8 + rnd() * 30, 20 + rnd() * 60, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }

  const map = toTexture(ctx, true);
  map.anisotropy = 8;
  const normalMap = heightToNormal(h, kind === 'eucalyptus' || kind === 'crape' ? 0.8 : 3.5);
  normalMap.anisotropy = 4;
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// Leaf cluster atlases — 1024², 2×2 cells; each cell is one card: a few
// twiglets carrying many small leaves, alpha-cut (alphaTest 0.5). The card's
// base (where it attaches to the twig) is the bottom of the cell.
// ---------------------------------------------------------------------------

export type LeafKind = 'oak' | 'pine' | 'eucalyptus' | 'olive' | 'crape' | 'lavender' | 'shrub';

export function leafAtlasTexture(kind: LeafKind): THREE.DataTexture {
  const S = 1024;
  const C = S / 2;
  const rnd = mulberry32(
    { oak: 0x1eaf, pine: 0x9ee, eucalyptus: 0xe7c, olive: 0x0117e, crape: 0xc7a, lavender: 0x1a7, shrub: 0x5b }[kind],
  );
  const ctx = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);

  const leafShape = (x: number, y: number, len: number, wid: number, ang: number, fill: string, rib: string | null, hi: string | null) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid * 0.9, len * 0.18, wid * 0.75, len * 0.78, 0, len);
    ctx.bezierCurveTo(-wid * 0.75, len * 0.78, -wid * 0.9, len * 0.18, 0, 0);
    ctx.fill();
    if (hi) {
      // convex leaf: one half catches more light
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.moveTo(0, len * 0.08);
      ctx.bezierCurveTo(wid * 0.7, len * 0.22, wid * 0.55, len * 0.72, 0, len * 0.94);
      ctx.closePath();
      ctx.fill();
    }
    if (rib) {
      ctx.strokeStyle = rib;
      ctx.lineWidth = Math.max(0.8, wid * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, len * 0.04);
      ctx.lineTo(0, len * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  };

  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C;
    const oy = ((cell / 2) | 0) * C;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + 2, oy + 2, C - 4, C - 4);
    ctx.clip();
    const bx = ox + C / 2;
    const by = oy + C - 6; // attachment point: bottom centre

    if (kind === 'oak' || kind === 'olive' || kind === 'crape' || kind === 'shrub') {
      // dense clusters: the card should read ~60% opaque so a few layers
      // of cards make a solid crown with sky holes (not a sparse speckle)
      const pal =
        kind === 'oak'
          ? { f: ['#233619', '#2B401E', '#334A24', '#2A3C1F', '#3C5228', '#1F3016'], hi: 'rgba(120,140,92,0.22)', rib: 'rgba(120,132,90,0.3)', lMin: 26, lVar: 20, wr: 0.62, n: 330 }
          : kind === 'olive'
            ? { f: ['#56644A', '#687458', '#78846A', '#8A9480', '#4E5A44'], hi: 'rgba(200,205,190,0.3)', rib: 'rgba(190,196,180,0.35)', lMin: 52, lVar: 30, wr: 0.2, n: 300 }
            : kind === 'crape'
              ? { f: ['#34502A', '#40602F', '#4A6A34', '#304A2A'], hi: 'rgba(150,170,110,0.22)', rib: null, lMin: 40, lVar: 24, wr: 0.5, n: 190 }
              : { f: ['#304C26', '#3C5A2C', '#284020', '#46622F'], hi: 'rgba(140,165,100,0.2)', rib: null, lMin: 34, lVar: 18, wr: 0.55, n: 240 };
      // twiglets fanning from the base
      const nTw = 4 + ((rnd() * 3) | 0);
      const twigs: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (let t = 0; t < nTw; t++) {
        const a = -Math.PI / 2 + (t / (nTw - 1) - 0.5) * 1.9 + (rnd() - 0.5) * 0.3;
        const L = C * (0.4 + rnd() * 0.16);
        const x1 = bx + Math.cos(a) * L;
        const y1 = by + Math.sin(a) * L;
        twigs.push({ x0: bx, y0: by, x1, y1 });
        ctx.strokeStyle = '#3E3024';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + x1) / 2 + (rnd() - 0.5) * 40, (by + y1) / 2, x1, y1);
        ctx.stroke();
      }
      for (let i = 0; i < pal.n; i++) {
        const tw = twigs[(rnd() * twigs.length) | 0];
        const t = 0.12 + rnd() * 0.95;
        let px = tw.x0 + (tw.x1 - tw.x0) * t + (rnd() - 0.5) * 70;
        let py = tw.y0 + (tw.y1 - tw.y0) * t + (rnd() - 0.5) * 70;
        // pull strays back inside an ellipse around the cell centre
        const ex = (px - (ox + C / 2)) / (C * 0.4);
        const ey = (py - (oy + C * 0.52)) / (C * 0.44);
        const e = Math.hypot(ex, ey);
        if (e > 1) {
          px = ox + C / 2 + (ex / e) * C * 0.4 * (0.75 + rnd() * 0.25);
          py = oy + C * 0.52 + (ey / e) * C * 0.44 * (0.75 + rnd() * 0.25);
        }
        const dir = Math.atan2(tw.y1 - tw.y0, tw.x1 - tw.x0);
        const side = rnd() < 0.5 ? -1 : 1;
        const ang = dir - Math.PI / 2 + side * (0.4 + rnd() * 1.1);
        const len = pal.lMin + rnd() * pal.lVar;
        leafShape(px, py, len, len * pal.wr * (0.8 + rnd() * 0.4), ang, pal.f[(rnd() * pal.f.length) | 0], pal.rib, rnd() < 0.6 ? pal.hi : null);
      }
    } else if (kind === 'eucalyptus') {
      // long pendulous sickle leaves hanging from a thin twig across the top
      const x0 = ox + 30;
      const x1 = ox + C - 30;
      const ty = oy + 50 + rnd() * 30;
      ctx.strokeStyle = '#6E5A48';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, ty + 10);
      ctx.quadraticCurveTo((x0 + x1) / 2, ty - 20, x1, ty + 15);
      ctx.stroke();
      const cols = ['#7D907E', '#6F8472', '#8FA08C', '#62786A', '#9AAA96'];
      for (let i = 0; i < 44; i++) {
        const px = x0 + rnd() * (x1 - x0);
        const len = 140 + rnd() * 170;
        const ang = (rnd() - 0.5) * 0.7; // hanging down (+y)
        ctx.save();
        ctx.translate(px, ty);
        ctx.rotate(ang);
        ctx.fillStyle = cols[(rnd() * cols.length) | 0];
        const w = 12 + rnd() * 8;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(w, len * 0.3, w * 0.6, len * 0.75, 4, len);
        ctx.bezierCurveTo(-w * 0.3, len * 0.7, -w * 0.9, len * 0.3, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    } else if (kind === 'pine') {
      // stone pine tufts: dense bursts of paired needles at shoot tips
      const nTufts = 9 + ((rnd() * 4) | 0);
      for (let t = 0; t < nTufts; t++) {
        const tx = ox + C * (0.2 + rnd() * 0.6);
        const ty = oy + C * (0.2 + rnd() * 0.55);
        ctx.strokeStyle = '#5A4030';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + tx) / 2 + (rnd() - 0.5) * 60, (by + ty) / 2, tx, ty);
        ctx.stroke();
        const n = 110;
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2;
          const len = 70 + rnd() * 70;
          const cols = ['#3F5A2C', '#4C6832', '#56743A', '#35502A', '#627E44'];
          ctx.strokeStyle = cols[(rnd() * cols.length) | 0];
          ctx.lineWidth = 1.6 + rnd() * 1.2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.quadraticCurveTo(tx + Math.cos(a) * len * 0.5, ty + Math.sin(a) * len * 0.5 - 8, tx + Math.cos(a) * len, ty + Math.sin(a) * len);
          ctx.stroke();
        }
      }
    } else {
      // lavender: grey-green needle foliage with violet flower wands
      for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.3;
        const len = 80 + rnd() * 140;
        ctx.strokeStyle = ['#7D8A70', '#8C9880', '#6E7C64'][(rnd() * 3) | 0];
        ctx.lineWidth = 2 + rnd() * 2;
        ctx.beginPath();
        ctx.moveTo(bx + (rnd() - 0.5) * 80, by);
        ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 34; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.1;
        const len = 200 + rnd() * 180;
        const x1 = bx + Math.cos(a) * len;
        const y1 = by + Math.sin(a) * len;
        ctx.strokeStyle = '#7E8A6C';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.fillStyle = ['#7B6A9A', '#8A78A8', '#6C5E8C', '#9486B0'][(rnd() * 4) | 0];
        for (let k = 0; k < 7; k++) {
          ctx.beginPath();
          ctx.ellipse(x1 - Math.cos(a) * k * 6, y1 - Math.sin(a) * k * 6, 5, 7, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
  return alphaCutTexture(ctx);
}

/** Dry deck litter: 4×4 atlas of fallen oak leaves (tan/brown/olive). */
export function litterAtlasTexture(): THREE.DataTexture {
  const S = 512;
  const C = S / 4;
  const rnd = mulberry32(0x11e7);
  const ctx = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cols = ['#8A6A45', '#A0804F', '#6E5236', '#7A6A40', '#5C5A34', '#B39062', '#6B4A30'];
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * C + C / 2;
    const cy = ((i / 4) | 0) * C + C / 2;
    const len = C * (0.6 + rnd() * 0.3);
    const wid = len * (0.45 + rnd() * 0.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rnd() * Math.PI * 2);
    ctx.fillStyle = cols[(rnd() * cols.length) | 0];
    ctx.beginPath();
    // spiny-toothed live-oak outline
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const y = -len / 2 + t * len;
      const w = Math.sin(t * Math.PI) * wid * 0.5 * (k % 2 ? 1.08 : 0.92);
      if (k === 0) ctx.moveTo(0, y);
      else ctx.lineTo(w, y);
    }
    for (let k = n; k >= 0; k--) {
      const t = k / n;
      const y = -len / 2 + t * len;
      const w = Math.sin(t * Math.PI) * wid * 0.5 * (k % 2 ? 1.08 : 0.92);
      ctx.lineTo(-w, y);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,25,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0, len / 2 + 6);
    ctx.stroke();
    ctx.restore();
  }
  const t = alphaCutTexture(ctx);
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Asphalt (1024² = 160") and slope ground (1024² = 120").
// ---------------------------------------------------------------------------

export function asphaltTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const S = 1024;
  const rnd = mulberry32(0xa5f);
  const ctx = makeCanvas(S, S);
  const rough = makeCanvas(S, S);
  ctx.fillStyle = '#56575A';
  ctx.fillRect(0, 0, S, S);
  rough.fillStyle = '#e0e0e0';
  rough.fillRect(0, 0, S, S);
  // aggregate speckle
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const r = rnd();
    const v = r < 0.08 ? 40 : r < 0.16 ? -30 : (rnd() - 0.5) * 16;
    d[k] += v;
    d[k + 1] += v;
    d[k + 2] += v + (r < 0.05 ? 6 : 0);
  }
  ctx.putImageData(img, 0, 0);
  // worn/patched blotches and oil drips
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 30 + rnd() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.5;
    g.addColorStop(0, dark ? 'rgba(20,20,22,0.18)' : 'rgba(150,150,150,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // hairline cracks
  ctx.strokeStyle = 'rgba(25,25,27,0.55)';
  for (let i = 0; i < 18; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    ctx.lineWidth = 1 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const map = toTexture(ctx, true);
  map.anisotropy = 8;
  return { map, roughnessMap: toTexture(rough, false) };
}

export function groundTexture(): THREE.CanvasTexture {
  // mulch, leaf litter and dry grass tufts under the slope planting
  const S = 1024;
  const rnd = mulberry32(0x6a0d);
  const ctx = makeCanvas(S, S);
  ctx.fillStyle = '#7A7263';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const c = rnd();
    ctx.fillStyle = c < 0.3 ? '#5A5246' : c < 0.55 ? '#8A7F6C' : c < 0.75 ? '#9A8E76' : c < 0.9 ? '#6E7060' : '#A89C82';
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + rnd() * 5, 1 + rnd() * 2.5, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // dry grass blades
  for (let i = 0; i < 2500; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const l = 6 + rnd() * 14;
    ctx.strokeStyle = rnd() < 0.6 ? '#B0A27E' : '#8A8C70';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = toTexture(ctx, true);
  t.anisotropy = 8;
  return t;
}

/** White ribbed modular-trailer siding with blue trim bands; 512×256 = one
 * 48" wide × 120" tall panel run (u along the trailer, v up). */
export function trailerSidingTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const ctx = makeCanvas(W, H);
  ctx.fillStyle = '#E9EBEA';
  ctx.fillRect(0, 0, W, H);
  // vertical ribs every 4"
  for (let x = 0; x < W; x += W / 12) {
    const g = ctx.createLinearGradient(x, 0, x + W / 12, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.07)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(0.9, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, W / 12, H);
  }
  // grime at the bottom
  const grime = ctx.createLinearGradient(0, H * 0.8, 0, H);
  grime.addColorStop(0, 'rgba(90,85,70,0)');
  grime.addColorStop(1, 'rgba(90,85,70,0.25)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, H * 0.8, W, H * 0.2);
  const t = toTexture(ctx, true);
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Backdrops. Both are consumed by atmosphere.ts as open cylinders centred on
// the room (x 272.5", z 299.5"): the panorama is R 85 m, 40 m tall, centre
// y 7 m (canvas top = y 27 m, bottom = y −13 m); the treetop ring is R 58 m,
// 13 m tall, centre y −0.8 m. Rows are laid out by true elevation angle seen
// from deck eye height (60" = 1.52 m) so the painted horizon sits at 0–1°.
// Column → azimuth: θ = col/W·2π around the cylinder, model azimuth
// atan2(sin θ, −cos θ) (0 = model −z), true azimuth = model + 50°.
// ---------------------------------------------------------------------------

const EYE_M = 1.524;
const FACADE_AZ = 50;

function trueAzOfCol(col: number, W: number): number {
  const th = (col / W) * Math.PI * 2;
  const modelAz = (Math.atan2(Math.sin(th), -Math.cos(th)) * 180) / Math.PI;
  return (((modelAz + FACADE_AZ) % 360) + 360) % 360;
}

/** −180..180 difference a − b in degrees */
function dAz(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

/** 1 for an azimuth inside [a0, a1] (clockwise), fading to 0 over
 * `feather` degrees outside it */
function sector(az: number, a0: number, a1: number, feather: number): number {
  const span = (a1 - a0 + 360) % 360;
  const into = (az - a0 + 360) % 360;
  if (into <= span) return 1;
  const past = into - span;
  const before = 360 - into;
  return Math.max(0, 1 - Math.min(past, before) / feather);
}

/** 1-D value noise, periodic over 360° */
function azNoise(seed: number, octaves: [number, number][]): (az: number) => number {
  const rnd = mulberry32(seed);
  const tables = octaves.map(([cells]) => Array.from({ length: cells }, () => rnd() * 2 - 1));
  return (az: number) => {
    let v = 0;
    octaves.forEach(([cells, amp], o) => {
      const t = ((az % 360) + 360) % 360 / 360 * cells;
      const i = Math.floor(t);
      const f = t - i;
      const a = tables[o][i % cells];
      const b = tables[o][(i + 1) % cells];
      const s = f * f * (3 - 2 * f);
      v += (a + (b - a) * s) * amp;
    });
    return v;
  };
}

/** build times of the backdrop textures (ms), for the QA stats hook */
export const backdropTimings: Record<string, number> = {};

export function bayPanoramaTextureImpl(): THREE.CanvasTexture {
  const tStart = performance.now();
  const W = 8192;
  const H = 1024;
  const R = 85;
  const TOP = 27;
  const SPAN = 40;
  const ctx = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const rnd = mulberry32(0xba7);
  const rowOf = (elevDeg: number) => ((TOP - (EYE_M + R * Math.tan((elevDeg * Math.PI) / 180))) / SPAN) * H;
  const azs = Float32Array.from({ length: W }, (_, x) => trueAzOfCol(x + 0.5, W));
  const pxPerDeg = W / 360;

  // silhouette band: a per-column top elevation down to `botDeg`, filled as
  // one path (runs where the top is defined) with a vertical gradient
  const band = (topDeg: (az: number) => number, botDeg: number, stops: [number, string][]) => {
    const tops = new Float32Array(W).fill(NaN);
    const yb = rowOf(botDeg);
    let yMin = yb;
    ctx.beginPath();
    let open = false;
    for (let x = 0; x <= W; x++) {
      const t = x < W ? topDeg(azs[x]) : NaN;
      if (Number.isFinite(t)) {
        const y = rowOf(t);
        tops[x] = y;
        yMin = Math.min(yMin, y);
        if (!open) {
          ctx.moveTo(x, yb);
          open = true;
        }
        ctx.lineTo(x, y);
        ctx.lineTo(x + 1, y);
      } else if (open) {
        ctx.lineTo(x, yb);
        ctx.closePath();
        open = false;
      }
    }
    const g = ctx.createLinearGradient(0, yMin, 0, yb);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fill();
    return tops;
  };
  /** recolour already-painted land inside an azimuth sector */
  const tintSector = (a0: number, a1: number, feather: number, color: string, alpha: number, y0: number, y1: number) => {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    for (let x = 0; x < W; x++) {
      const w = sector(azs[x], a0, a1, feather);
      if (w <= 0.01) continue;
      ctx.globalAlpha = w * alpha;
      ctx.fillRect(x, y0, 1, y1 - y0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // --- 1. far East Bay hills across the water (25–40 km): barely there ----
  const eastN = azNoise(0xe1, [
    [36, 0.25],
    [140, 0.08],
    [520, 0.025],
  ]);
  band(
    (az) => {
      const w = sector(az, 350, 125, 20);
      if (w <= 0.01) return NaN;
      // Mission Peak massif rises toward ~95°, lower toward Oakland (N)
      const lift = 0.45 + 0.5 * Math.exp(-(dAz(az, 96) ** 2) / 300) + 0.25 * Math.exp(-(dAz(az, 40) ** 2) / 500);
      return -0.5 + w * (0.3 + lift + eastN(az));
    },
    -0.5,
    [
      [0, 'rgba(150,152,172,0.62)'],
      [1, 'rgba(166,172,186,0.72)'],
    ],
  );

  // --- 2. the Bay: a pale band just below the far shore ------------------
  {
    const y0 = rowOf(-0.22);
    const y1 = rowOf(-0.62);
    const yb = rowOf(-0.42);
    for (let x = 0; x < W; x++) {
      const az = azs[x];
      const w = sector(az, 5, 110, 14);
      if (w <= 0.01) continue;
      ctx.globalAlpha = 0.75 * w;
      ctx.fillStyle = '#C0C9D2';
      ctx.fillRect(x, y0, 1, (y1 - y0) * 0.5);
      ctx.fillStyle = '#ABB8C2';
      ctx.fillRect(x, y0 + (y1 - y0) * 0.5, 1, (y1 - y0) * 0.5);
      // Dumbarton bridge: a thin dark thread low on the water (~56–70°)
      const br = sector(az, 54, 70, 2);
      if (br > 0.1) {
        ctx.globalAlpha = 0.55 * br;
        ctx.fillStyle = '#5C626E';
        ctx.fillRect(x, yb, 1, 1.4);
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- 3. Santa Cruz Mountains W/SW (6–12 km): the one high skyline --------
  const scN = azNoise(0x5c, [
    [24, 0.9],
    [90, 0.35],
    [300, 0.12],
    [900, 0.04],
  ]);
  band(
    (az) => {
      const w = sector(az, 175, 345, 30);
      if (w <= 0.01) return NaN;
      const ridge = 2.2 + 1.6 * Math.exp(-(dAz(az, 250) ** 2) / 2600) + scN(az);
      return -0.4 + w * (0.6 + ridge);
    },
    -0.4,
    [
      [0, 'rgba(124,136,150,0.8)'],
      [1, 'rgba(108,122,126,0.92)'],
    ],
  );
  // nearer foothills (Jasper Ridge, Woodside, 1–4 km): darker green-grey,
  // dry gold on the Stanford "Dish" hills to the south
  const fhN = azNoise(0xf0, [
    [40, 0.45],
    [160, 0.18],
    [700, 0.05],
  ]);
  const footTops = band(
    (az) => {
      const w = sector(az, 150, 20, 25);
      if (w <= 0.01) return NaN;
      const west = sector(az, 190, 320, 30);
      return -1.2 + w * (1.1 + 0.55 + 0.9 * west + fhN(az));
    },
    -1.2,
    [
      [0, 'rgba(96,108,96,0.94)'],
      [1, 'rgba(84,96,82,1)'],
    ],
  );
  tintSector(140, 200, 25, '#A0967A', 0.85, rowOf(3), rowOf(-1.2));
  // oak dots on the foothills
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * W) | 0;
    if (!Number.isFinite(footTops[x])) continue;
    const y = footTops[x] + 1 + rnd() * (rowOf(-1.2) - footTops[x]);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(62,74,58,0.55)' : 'rgba(78,90,70,0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + rnd() * 3, 1 + rnd() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 4. flatland urban forest (Menlo Park / Palo Alto / Stanford) --------
  const shelfN = azNoise(0x5e1f, [
    [80, 0.18],
    [400, 0.07],
  ]);
  const shelfTops = band((az) => -0.55 + shelfN(az) - 0.25 * sector(az, 150, 330, 30), -6, [
    [0, 'rgba(128,138,120,1)'],
    [1, 'rgba(96,108,84,1)'],
  ]);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W;
    const top = shelfTops[x | 0];
    const y = top + rnd() * (rowOf(-3.2) - top);
    const cols = ['rgba(110,122,100,0.7)', 'rgba(90,104,84,0.7)', 'rgba(132,140,118,0.6)', 'rgba(80,94,74,0.6)'];
    ctx.fillStyle = cols[(rnd() * cols.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rnd() * 5, 1.5 + rnd() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // roofs and the odd tall redwood / palm breaking the canopy line
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const az = azs[x | 0];
    const top = shelfTops[x | 0];
    const y = top + 2 + rnd() * (rowOf(-2.4) - top);
    const stanford = sector(az, 60, 100, 6);
    ctx.fillStyle = stanford > 0.5 && rnd() < 0.6 ? 'rgba(178,112,84,0.8)' : ['rgba(200,196,184,0.65)', 'rgba(170,150,130,0.6)', 'rgba(150,146,140,0.6)'][(rnd() * 3) | 0];
    ctx.fillRect(x, y, 2 + rnd() * 5, 1 + rnd() * 1.5);
  }
  for (let i = 0; i < 120; i++) {
    const x = rnd() * W;
    const top = shelfTops[x | 0];
    const h = 3 + rnd() * 9;
    ctx.fillStyle = 'rgba(70,84,66,0.8)';
    ctx.beginPath();
    ctx.moveTo(x - 2, top + 3);
    ctx.lineTo(x, top - h);
    ctx.lineTo(x + 2, top + 3);
    ctx.fill();
  }

  // Hoover Tower — true azimuth ≈74°, ~3.8 km: shaft from −1.35° to ≈0°,
  // ~0.17° wide, sandstone with a terracotta dome
  {
    let col = 0;
    for (let x = 1; x < W; x++) if (Math.abs(dAz(azs[x], 74)) < Math.abs(dAz(azs[col], 74))) col = x;
    const w = Math.max(3, 0.17 * pxPerDeg);
    const yTop = rowOf(-0.1);
    const yBase = rowOf(-1.35);
    ctx.fillStyle = 'rgba(196,182,152,0.95)';
    ctx.fillRect(col - w / 2, yTop + 3, w, yBase - yTop - 3);
    ctx.fillStyle = 'rgba(170,154,126,0.95)';
    ctx.fillRect(col - w / 2 - 0.5, yTop + 3, w + 1, 2.2); // belfry band
    ctx.fillStyle = 'rgba(170,96,62,0.95)';
    ctx.beginPath();
    ctx.ellipse(col, yTop + 3, w * 0.42, 3, 0, Math.PI, 0);
    ctx.fill();
    // campus buildings at its foot
    ctx.fillStyle = 'rgba(190,170,140,0.8)';
    ctx.fillRect(col - 26, yBase - 3, 52, 3);
    ctx.fillStyle = 'rgba(170,100,72,0.8)';
    ctx.fillRect(col - 30, yBase - 4.5, 60, 1.6);
  }

  // --- 5. near canopy rolling down the knoll (below −3°) --------------------
  const nearN = azNoise(0x7ea, [
    [60, 0.5],
    [240, 0.25],
  ]);
  const nearTops = band((az) => -3.0 + nearN(az), -10, [
    [0, 'rgba(84,98,68,1)'],
    [1, 'rgba(52,64,42,1)'],
  ]);
  for (let i = 0; i < 11000; i++) {
    const x = rnd() * W;
    const top = nearTops[x | 0];
    const y = top + rnd() * (H - top);
    const r = 2.5 + rnd() * 6;
    // shaded crown with a sunlit cap (two flat fills; gradients are slow)
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(58,70,46,0.7)' : 'rgba(66,78,52,0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(86,100,68,0.4)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.35, r * 0.8, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 6. aerial perspective: land hazes toward the horizon ---------------
  {
    const y0 = rowOf(4.5);
    const y1 = rowOf(-4);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(206,212,222,0.35)');
    g.addColorStop(0.5, 'rgba(206,212,222,0.3)');
    g.addColorStop(1, 'rgba(206,212,222,0)');
    ctx.globalCompositeOperation = 'source-atop'; // only over painted land
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);
    ctx.globalCompositeOperation = 'source-over';
  }

  backdropTimings.panorama = Math.round(performance.now() - tStart);
  const t = new THREE.CanvasTexture(ctx.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

export function treetopRingTextureImpl(): THREE.CanvasTexture {
  // mid-distance canopy (the oak woodland rolling down from the knoll):
  // crowns crest between ~−1° and −5° from the deck, never above the horizon
  const tStart = performance.now();
  const W = 4096;
  const H = 512;
  const R = 58;
  const TOP = 5.7;
  const SPAN = 13;
  const rnd = mulberry32(0x7ee8);
  const ctx = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const rowOf = (elevDeg: number) => ((TOP - (EYE_M + R * Math.tan((elevDeg * Math.PI) / 180))) / SPAN) * H;
  const crownN = azNoise(0xc0, [
    [50, 1.2],
    [200, 0.6],
  ]);

  const clump = (x: number, y: number, r: number, lit: string, shade: string) => {
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, lit);
    g.addColorStop(0.65, shade);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // back row (farther, hazier) then front row
  for (const row of [0, 1]) {
    let x = -200;
    while (x < W + 200) {
      const az = trueAzOfCol(((x % W) + W) % W, W);
      const crest = -2.2 + crownN(az) + (row ? -1.1 : 0) + (rnd() < 0.12 ? 1.3 : 0);
      const topY = rowOf(Math.min(-0.6, crest));
      const groupW = 60 + rnd() * 160;
      const n = 6 + ((rnd() * 8) | 0);
      for (let i = 0; i < n; i++) {
        const cx = x + rnd() * groupW;
        const r = 9 + rnd() * 16;
        const cy = topY + r * 0.8 + rnd() * 40;
        const dark = rnd() < 0.45;
        const lit = row ? (dark ? '#5C6C44' : '#6E7E50') : dark ? '#707C60' : '#7E8A68';
        const sh = row ? (dark ? '#3A482E' : '#475636') : '#5A664C';
        for (const dx of [0, -W, W]) clump(cx + dx, cy, r, lit, sh);
      }
      x += groupW * (0.7 + rnd() * 0.5);
    }
    // fill beneath this row's crowns
    ctx.fillStyle = row ? 'rgba(52,62,40,1)' : 'rgba(84,94,72,1)';
    ctx.fillRect(0, rowOf(-5.4 - row), W, H);
  }
  // pale eucalyptus / pine accents poking up
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    const top = rowOf(-1.2 - rnd() * 1.5);
    const r = 8 + rnd() * 10;
    clump(x, top + r, r, '#8E9C88', '#66786A');
  }
  // haze so the band recedes
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(208,216,224,0.14)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  backdropTimings.treetopRing = Math.round(performance.now() - tStart);

  const t = new THREE.CanvasTexture(ctx.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}
