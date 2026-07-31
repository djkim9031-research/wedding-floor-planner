import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { i2m, DECK, ROOM_W, ROOM_D } from '../constants';
import { deckWoodTexture, skyTexture, valleyTexture } from './textures';

type Geo = THREE.BufferGeometry;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const g = new THREE.BoxGeometry(i2m(x1 - x0), i2m(y1 - y0), i2m(z1 - z0));
  g.translate(i2m((x0 + x1) / 2), i2m((y0 + y1) / 2), i2m((z0 + z1) / 2));
  return g;
}

function merged(geos: Geo[], mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(mergeGeometries(geos)!, mat);
}

const fract = (n: number) => n - Math.floor(n);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildExterior(): THREE.Group {
  const group = new THREE.Group();

  // -------------------------------------------------------------------------
  // Deck slab, top flush with the interior floor at y=0.
  // -------------------------------------------------------------------------
  const deckTex = deckWoodTexture();
  deckTex.repeat.set((DECK.x1 - DECK.x0) / 96, (DECK.z1 - DECK.z0) / 96);
  const deck = new THREE.Mesh(
    box(DECK.x0, DECK.x1, -12, 0, DECK.z0, DECK.z1),
    new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, metalness: 0 }),
  );
  deck.receiveShadow = true;
  group.add(deck);

  // -------------------------------------------------------------------------
  // Cable railing on the three outer edges (none where the deck meets the room).
  // -------------------------------------------------------------------------
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4f38, roughness: 0.8, metalness: 0 });
  const posts: { x: number; z: number }[] = [];
  const edgeRuns: [number, number, number, number][] = [
    [DECK.x0 + 2, -2, DECK.x0 + 2, DECK.z0 + 2], // west
    [DECK.x0 + 2, DECK.z0 + 2, DECK.x1 - 2, DECK.z0 + 2], // north
    [DECK.x1 - 2, DECK.z0 + 2, DECK.x1 - 2, -2], // east
  ];
  for (const [x0, z0, x1, z1] of edgeRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 72));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t };
      if (!posts.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.z - p.z) < 1)) posts.push(p);
    }
  }
  const postGeo = box(-2, 2, 0, 38, -2, 2);
  const postIM = new THREE.InstancedMesh(postGeo, woodMat, posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach((p, k) => {
    m4.makeTranslation(i2m(p.x), 0, i2m(p.z));
    postIM.setMatrixAt(k, m4);
  });
  postIM.instanceMatrix.needsUpdate = true;
  postIM.frustumCulled = false;
  postIM.castShadow = true;
  group.add(postIM);

  const capG: Geo[] = [];
  for (const [x0, z0, x1, z1] of edgeRuns) {
    capG.push(box(Math.min(x0, x1) - 3, Math.max(x0, x1) + 3, 38, 41, Math.min(z0, z1) - 3, Math.max(z0, z1) + 3));
  }
  group.add(merged(capG, woodMat));

  const cableG: Geo[] = [];
  for (const [x0, z0, x1, z1] of edgeRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let row = 0; row < 9; row++) {
      const y = 6 + row * 3.5;
      const g = new THREE.CylinderGeometry(i2m(0.22), i2m(0.22), i2m(len), 5);
      if (z0 === z1) g.rotateZ(Math.PI / 2); // run along x
      else g.rotateX(Math.PI / 2); // run along z
      g.translate(i2m((x0 + x1) / 2), i2m(y), i2m((z0 + z1) / 2));
      cableG.push(g);
    }
  }
  group.add(merged(cableG, new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.35, metalness: 0.9 })));

  // -------------------------------------------------------------------------
  // Bronze planters (tapered square = 4-segment cylinder), each with a shrub.
  // -------------------------------------------------------------------------
  const foliageG: Geo[] = [];
  const foliageColors = ['#47573A', '#3E5233', '#526344'];

  const blob = (rnd: () => number, cx: number, cy: number, cz: number, r: number, hex: string) => {
    const g = new THREE.IcosahedronGeometry(i2m(r), 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(hex);
    const seed = rnd() * 10;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      // hash by position: shared corners displace identically -> no cracks
      const h = fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed) * 43758.5453);
      const s = 0.78 + h * 0.45;
      pos.setXYZ(k, x * s, y * s * 0.82, z * s); // slightly squashed canopy
      const sh = 0.82 + fract(h * 7.31) * 0.33;
      col[k * 3] = c.r * sh;
      col[k * 3 + 1] = c.g * sh;
      col[k * 3 + 2] = c.b * sh;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.translate(i2m(cx), i2m(cy), i2m(cz));
    foliageG.push(g);
  };

  const planterRnd = mulberry32(0x9042);
  const planterG: Geo[] = [];
  const planterSpots: [number, number][] = [
    [-70, -36],
    [150, -262],
    [620, -40],
  ];
  for (const [px, pz] of planterSpots) {
    const g = new THREE.CylinderGeometry(i2m(13), i2m(10), i2m(30), 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(i2m(px), i2m(15), i2m(pz));
    planterG.push(g);
    blob(planterRnd, px, 40, pz, 15, foliageColors[1]);
  }
  const planters = merged(planterG, new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.5, metalness: 0.45 }));
  planters.castShadow = true;
  planters.receiveShadow = true;
  group.add(planters);

  // -------------------------------------------------------------------------
  // Procedural live oaks — CatmullRom tube trunks + noisy icosahedron canopies.
  // -------------------------------------------------------------------------
  const barkG: Geo[] = [];

  const oak = (seed: number, bx: number, bz: number, leanDeg: number, ldx: number, ldz: number, h: number, baseY: number) => {
    const rnd = mulberry32(seed);
    const leanRun = Math.tan((leanDeg * Math.PI) / 180) * h;
    const dl = Math.hypot(ldx, ldz) || 1;
    const dx = ldx / dl;
    const dz = ldz / dl;
    const P = (t: number, wob: number) =>
      new THREE.Vector3(
        i2m(bx + dx * leanRun * t * t + (rnd() - 0.5) * wob),
        i2m(baseY + (h - baseY) * t),
        i2m(bz + dz * leanRun * t * t + (rnd() - 0.5) * wob),
      );
    const pts = [P(0, 0), P(0.3, 8), P(0.6, 12), P(0.85, 14), P(1, 16)];

    const tube = (curvePts: THREE.Vector3[], r: number, segs: number) => {
      const curve = new THREE.CatmullRomCurve3(curvePts);
      barkG.push(new THREE.TubeGeometry(curve, segs, i2m(r), 7, false));
    };
    tube(pts.slice(0, 3), 9, 8); // lower trunk
    tube(pts.slice(2), 5.5, 8); // upper trunk
    for (let b = 0; b < 2; b++) {
      const from = pts[3].clone();
      const dir = new THREE.Vector3(
        (rnd() - 0.5) * 2,
        0.35 + rnd() * 0.3,
        (rnd() - 0.5) * 2,
      ).normalize();
      const to = from.clone().addScaledVector(dir, i2m(70 + rnd() * 50));
      const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, i2m(10), 0));
      tube([from, mid, to], 3.5, 6);
    }

    const top = pts[4];
    const nBlobs = 2 + ((rnd() * 2) | 0);
    for (let b = 0; b < nBlobs; b++) {
      const ox = (rnd() - 0.5) * 150;
      const oz = (rnd() - 0.5) * 150;
      const oy = (rnd() - 0.5) * 60;
      blob(
        rnd,
        top.x / i2m(1) + ox,
        top.y / i2m(1) + 15 + oy,
        top.z / i2m(1) + oz,
        85 + rnd() * 45,
        foliageColors[(rnd() * foliageColors.length) | 0],
      );
    }
  };

  oak(1, 5, -185, 4, 1, -0.5, 260, -30);
  oak(2, 310, -150, 27, -0.5, -0.9, 230, -20);
  oak(3, 445, -100, 9, 0.6, -0.8, 250, -20);
  oak(4, 620, -360, 6, -0.3, -1, 300, -100);

  const bark = merged(barkG, new THREE.MeshStandardMaterial({ color: 0x5b4a3e, roughness: 0.95, metalness: 0 }));
  bark.castShadow = true;
  const foliage = merged(
    foliageG,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  );
  foliage.castShadow = true;
  group.add(bark, foliage);

  return group;
}

// ---------------------------------------------------------------------------
// Sky dome, valley backdrop and fog.
// ---------------------------------------------------------------------------

export function applyAtmosphere(scene: THREE.Scene): void {
  scene.fog = new THREE.Fog(0xe8eef2, 45, 160);

  const cx = i2m(ROOM_W / 2);
  const cz = i2m(ROOM_D / 2);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(250, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.position.set(cx, 0, cz);
  sky.renderOrder = -2;
  scene.add(sky);

  // haze is baked into the texture; fog would double-dip at 60m, so fog:false
  const valley = new THREE.Mesh(
    new THREE.CylinderGeometry(60, 60, 25, 48, 1, true, Math.PI - 1.25, 2.5),
    new THREE.MeshBasicMaterial({
      map: valleyTexture(),
      side: THREE.BackSide,
      transparent: true,
      fog: false,
      depthWrite: false,
    }),
  );
  valley.position.set(cx, 4, cz);
  valley.renderOrder = -1;
  scene.add(valley);
}
