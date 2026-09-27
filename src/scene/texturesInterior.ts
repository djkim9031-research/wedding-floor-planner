import * as THREE from 'three';

// Canvas2D textures for the hall interior and the covered deck bay (reference
// photos 02, 03, 05). Seeded so every load is identical; bump canvases are
// converted to normal maps by the render pipeline.

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

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Etched "SH" roundel on the frameless entry doors (photo 02). Drawn mirrored:
// the etching reads correctly from the entry court, so from inside the hall
// the S turns back to front. White on transparent; used as a decal plane.
// ---------------------------------------------------------------------------

export function entryLogoTexture(): THREE.CanvasTexture {
  const S = 512;
  const g = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  g.translate(S, 0);
  g.scale(-1, 1); // mirrored (seen from inside)
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineCap = 'butt';
  // outer ring
  g.lineWidth = 22;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();
  // H legs
  g.fillRect(S * 0.3, S * 0.24, 24, S * 0.52);
  g.fillRect(S * 0.7 - 24, S * 0.24, 24, S * 0.52);
  // S sweeping between the legs, closing into them like the H crossbar
  g.lineWidth = 24;
  g.beginPath();
  g.arc(S * 0.5, S * 0.39, S * 0.11, -0.15 * Math.PI, 0.5 * Math.PI, true);
  g.stroke();
  g.beginPath();
  g.arc(S * 0.5, S * 0.61, S * 0.11, -0.5 * Math.PI, 0.85 * Math.PI, false);
  g.stroke();
  const t = toTexture(g, true, false);
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// EXIT sign face: pale-green letters on a near-black face (photo 02).
// ---------------------------------------------------------------------------

export function exitSignTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const g = makeCanvas(W, H);
  g.fillStyle = '#10140f';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#5c6a58';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = '#d8f5c8';
  g.font = 'bold 76px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', W / 2, H / 2 + 4);
  return toTexture(g, true, false);
}

// ---------------------------------------------------------------------------
// Rough grey stucco pier at the covered bay's corner (photo 03): warm grey
// hand-trowelled render with horizontal drag ridges. 512px == 48".
// ---------------------------------------------------------------------------

export function stuccoPierTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 512;
  const rnd = mulberry32(0x57cc0);
  const c = makeCanvas(S, S);
  const b = makeCanvas(S, S);
  c.fillStyle = '#9C968A';
  c.fillRect(0, 0, S, S);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, S, S);
  // horizontal trowel drags: long thin ridges, wrapped in u
  for (let i = 0; i < 520; i++) {
    const y = rnd() * S;
    const x = rnd() * S;
    const len = 30 + rnd() * 200;
    const th = 1 + rnd() * 3.5;
    const lite = rnd() < 0.5;
    c.fillStyle = lite ? '#B8B2A5' : '#6E695F';
    c.globalAlpha = 0.08 + rnd() * 0.14;
    b.fillStyle = lite ? '#ffffff' : '#000000';
    b.globalAlpha = 0.12 + rnd() * 0.2;
    for (const ox of [0, -S]) {
      c.fillRect(x + ox, y, len, th);
      b.fillRect(x + ox, y, len, th);
    }
  }
  // fine speckle
  for (let i = 0; i < 5000; i++) {
    const v = rnd() < 0.5;
    c.fillStyle = v ? '#CFC9BC' : '#5A564E';
    c.globalAlpha = 0.1 + rnd() * 0.2;
    const x = rnd() * S;
    const y = rnd() * S;
    c.fillRect(x, y, 1.5, 1.5);
    b.fillStyle = v ? '#ffffff' : '#000000';
    b.globalAlpha = 0.15;
    b.fillRect(x, y, 1.5, 1.5);
  }
  c.globalAlpha = 1;
  b.globalAlpha = 1;
  return { map: toTexture(c, true), bumpMap: toTexture(b, false) };
}

// ---------------------------------------------------------------------------
// Covered-bay soffit: dark-stained tongue-and-groove planks, 3.5" face,
// running along u (parallel to the building face, photo 03). 1024px == 96".
// ---------------------------------------------------------------------------

export function soffitPlankTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const S = 1024;
  const PX = S / 96;
  const rnd = mulberry32(0x50ff);
  const c = makeCanvas(S, S);
  const b = makeCanvas(S, S);
  const rows = Math.round(96 / 3.5);
  const h = S / rows;
  const tones = ['#4E3524', '#553A27', '#48301F', '#5B3F2A', '#4A3322'];
  c.fillStyle = '#2A1C12';
  c.fillRect(0, 0, S, S);
  b.fillStyle = '#909090';
  b.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    let x = -rnd() * 60 * PX;
    while (x < S) {
      const len = (48 + rnd() * 96) * PX;
      c.fillStyle = tones[(rnd() * tones.length) | 0];
      c.fillRect(x, y + 1, len - 1.5, h - 2);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = rnd() < 0.6 ? '#2E1E12' : '#6E503A';
        c.globalAlpha = 0.1 + rnd() * 0.12;
        c.fillRect(x, y + 2 + rnd() * (h - 4), len, 0.8 + rnd());
      }
      c.globalAlpha = 1;
      b.fillStyle = '#404040';
      b.fillRect(x + len - 1.5, y, 1.5, h);
      x += len;
    }
    b.fillStyle = '#2a2a2a';
    b.fillRect(0, y, S, 1.5); // V-groove
    c.fillStyle = '#20150D';
    c.fillRect(0, y, S, 1.2);
  }
  return { map: toTexture(c, true), bumpMap: toTexture(b, false) };
}
