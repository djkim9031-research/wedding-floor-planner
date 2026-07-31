import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { i2m, DECK_POLY, DECK_TREES, ROOM_W, ROOM_D, EAVE_Y } from '../constants';
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
  // Deck slab from the traced Tree Deck outline, top flush with the floor.
  // -------------------------------------------------------------------------
  const deckTex = deckWoodTexture();
  deckTex.repeat.set(1 / i2m(96), 1 / i2m(96)); // ExtrudeGeometry UVs are in meters
  const shape = new THREE.Shape();
  DECK_POLY.forEach((p, k) => {
    if (k === 0) shape.moveTo(i2m(p.x), -i2m(p.z));
    else shape.lineTo(i2m(p.x), -i2m(p.z));
  });
  shape.closePath();
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: i2m(12), bevelEnabled: false });
  deckGeo.rotateX(Math.PI / 2); // shape (x,-z) + depth 12 down -> top at y=0
  deckGeo.translate(0, -i2m(0.4), 0); // sit just below the interior floor: no knife-edge seam
  const deck = new THREE.Mesh(
    deckGeo,
    new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, metalness: 0 }),
  );
  deck.receiveShadow = true;
  group.add(deck);

  // -------------------------------------------------------------------------
  // Cable railing along the outer edges (none along the building faces).
  // -------------------------------------------------------------------------
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4f38, roughness: 0.8, metalness: 0 });
  const edgeRuns: [number, number, number, number][] = [
    [-4, -2, -176, -2], // west overhang in front of the building
    [-176, -2, -176, -288], // west flank
    [-176, -288, 25, -496], // NW chamfer
    [25, -496, 546, -496], // top edge
    [546, -496, 735, -288], // NE chamfer
    [735, -288, 735, 143], // east flank
    [735, 143, 593, 143], // wrap south end
    [593, 143, 553, 77], // wrap inner diagonal
  ];
  const posts: { x: number; z: number }[] = [];
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

  // caps + cables share one transform: build along +x, yaw into place
  const alongRun = (g: Geo, x0: number, z0: number, x1: number, z1: number) => {
    g.rotateY(Math.atan2(-(z1 - z0), x1 - x0));
    g.translate(i2m((x0 + x1) / 2), 0, i2m((z0 + z1) / 2));
    return g;
  };
  const capG: Geo[] = [];
  const cableG: Geo[] = [];
  for (const [x0, z0, x1, z1] of edgeRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cap = new THREE.BoxGeometry(i2m(len + 6), i2m(3), i2m(6));
    cap.translate(0, i2m(39.5), 0);
    capG.push(alongRun(cap, x0, z0, x1, z1));
    for (let row = 0; row < 9; row++) {
      const cable = new THREE.CylinderGeometry(i2m(0.22), i2m(0.22), i2m(len), 5);
      cable.rotateZ(Math.PI / 2);
      cable.translate(0, i2m(6 + row * 3.5), 0);
      cableG.push(alongRun(cable, x0, z0, x1, z1));
    }
  }
  group.add(merged(capG, woodMat));
  group.add(merged(cableG, new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.35, metalness: 0.9 })));

  // wood curbs around the two plan-marked tree openings
  const curbG: Geo[] = [];
  for (const t of DECK_TREES) {
    curbG.push(box(t.x - 15, t.x + 15, 0, 2.5, t.z - 15, t.z - 12));
    curbG.push(box(t.x - 15, t.x + 15, 0, 2.5, t.z + 12, t.z + 15));
    curbG.push(box(t.x - 15, t.x - 12, 0, 2.5, t.z - 12, t.z + 12));
    curbG.push(box(t.x + 12, t.x + 15, 0, 2.5, t.z - 12, t.z + 12));
  }
  group.add(merged(curbG, woodMat));

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
    [150, -420],
    [620, -40],
    [700, 110],
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

  // one oak rises through the central deck opening; the rest are scenery
  // beyond the railing
  oak(2, DECK_TREES[0].x, DECK_TREES[0].z, 18, -0.5, -0.9, 260, -30);
  oak(3, 870, -180, 9, 0.6, -0.8, 250, -60);
  oak(4, -320, -380, 6, 0.3, -1, 300, -110);
  oak(1, 240, -620, 4, 1, -0.5, 280, -90);

  // -------------------------------------------------------------------------
  // South campus — hip-roofed wings flanking the breezeway, entry court with
  // the drop-off circle, dry-grass ground so the massing sits on something.
  // The court sits one terrace (10") below the wing grade.
  // -------------------------------------------------------------------------
  const grass = merged(
    [box(-1500, 1900, -3, -1, 600, 2160), box(-1500, 1900, -13, -11, 2160, 3150)],
    new THREE.MeshStandardMaterial({ color: 0xc9bfa3, roughness: 1, metalness: 0 }),
  );
  grass.receiveShadow = true;
  group.add(grass);

  // terrace edge where the grade steps down to the court
  const ledge = merged(
    [box(-1500, 70, -13, -0.9, 2154, 2162), box(475, 1900, -13, -0.9, 2154, 2162)],
    new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.95, metalness: 0 }),
  );
  ledge.castShadow = true;
  ledge.receiveShadow = true;
  group.add(ledge);

  // wings: stucco boxes to the eave + coarse hip roofs, 45° hips in plan
  const wingWallG: Geo[] = [];
  const winG: Geo[] = [];
  const hipPos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const up = u[2] * v[0] - u[0] * v[2] >= 0; // keep face normals pointing up
    const t = up ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
    for (const p of t) hipPos.push(i2m(p[0]), i2m(p[1]), i2m(p[2]));
  };
  const hip = (x0: number, x1: number, z0: number, z1: number) => {
    wingWallG.push(box(x0, x1, -2, EAVE_Y, z0, z1));
    const ov = 20;
    const zc = (z0 + z1) / 2;
    const ins = (z1 - z0) / 2;
    const e0 = [x0 - ov, 106, z0 - ov];
    const e1 = [x1 + ov, 106, z0 - ov];
    const e2 = [x1 + ov, 106, z1 + ov];
    const e3 = [x0 - ov, 106, z1 + ov];
    const r0 = [x0 + ins, 200, zc];
    const r1 = [x1 - ins, 200, zc];
    quad(e0, e1, r1, r0);
    quad(e3, e2, r1, r0);
    quad(e3, e0, r0, r0);
    quad(e1, e2, r1, r1);
  };
  hip(-900, 100, 800, 1450);
  hip(445, 1350, 800, 1450);
  hip(-760, 90, 1560, 2100); // second pair past the courtyard break
  hip(455, 1250, 1560, 2100);

  // a few dark openings on the walk-facing walls
  for (const wz of [900, 1030, 1160, 1290]) {
    winG.push(box(99.4, 100.6, 40, 88, wz, wz + 52));
    winG.push(box(444.4, 445.6, 40, 88, wz, wz + 52));
  }
  for (const wz of [1650, 1780, 1910]) {
    winG.push(box(89.4, 90.6, 40, 88, wz, wz + 52));
    winG.push(box(454.4, 455.6, 40, 88, wz, wz + 52));
  }

  const wingWalls = merged(wingWallG, new THREE.MeshStandardMaterial({ color: 0xede8dd, roughness: 0.95, metalness: 0 }));
  wingWalls.castShadow = true;
  wingWalls.receiveShadow = true;
  const hipGeo = new THREE.BufferGeometry();
  hipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hipPos), 3));
  hipGeo.computeVertexNormals();
  const wingRoofs = new THREE.Mesh(
    hipGeo,
    new THREE.MeshStandardMaterial({ color: 0x8b7365, roughness: 0.98, metalness: 0 }),
  );
  wingRoofs.castShadow = true;
  wingRoofs.receiveShadow = true;
  const wins = merged(winG, new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.4, metalness: 0.1 }));
  group.add(wingWalls, wingRoofs, wins);

  // drop-off circle with a planted center island
  const asphalt = new THREE.Mesh(
    new THREE.CylinderGeometry(i2m(260), i2m(260), i2m(1.2), 48).translate(i2m(272.5), i2m(-11.1), i2m(2480)),
    new THREE.MeshStandardMaterial({ color: 0x6f6c68, roughness: 0.97, metalness: 0 }),
  );
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb3ac9f, roughness: 0.9, metalness: 0 });
  const gap = 1.7; // curb ring opens where the walk feeds in from the north
  const curbGeo = new THREE.TorusGeometry(i2m(262), i2m(2.4), 6, 48, Math.PI * 2 - gap);
  curbGeo.rotateZ(-Math.PI / 2 + gap / 2);
  curbGeo.rotateX(Math.PI / 2);
  curbGeo.translate(i2m(272.5), i2m(-10.4), i2m(2480));
  const curb = new THREE.Mesh(curbGeo, curbMat);
  curb.castShadow = true;
  curb.receiveShadow = true;
  const islandCurb = new THREE.Mesh(
    new THREE.TorusGeometry(i2m(92), i2m(2.6), 6, 40).rotateX(Math.PI / 2).translate(i2m(272.5), i2m(-10.2), i2m(2480)),
    curbMat,
  );
  islandCurb.castShadow = true;
  islandCurb.receiveShadow = true;
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(i2m(90), i2m(90), i2m(2), 40).translate(i2m(272.5), i2m(-10), i2m(2480)),
    new THREE.MeshStandardMaterial({ color: 0x6b5b49, roughness: 1, metalness: 0 }),
  );
  soil.receiveShadow = true;
  group.add(curb, islandCurb, soil);

  const southRnd = mulberry32(0xb42);
  for (const [sx, sz] of [
    [210, 2445],
    [330, 2430],
    [225, 2525],
    [320, 2520],
  ] as const) {
    blob(southRnd, sx, 3, sz, 20, foliageColors[(southRnd() * 3) | 0]);
  }

  // breezeway planters along the post lines; the entry pair carries palms
  const bwPlanterG: Geo[] = [];
  const bwPlanter = (px: number, pz: number, y0: number, shrub: boolean) => {
    const g = new THREE.CylinderGeometry(i2m(13), i2m(10), i2m(30), 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(i2m(px), i2m(y0 + 15), i2m(pz));
    bwPlanterG.push(g);
    if (shrub) blob(southRnd, px, y0 + 40, pz, 15, foliageColors[(southRnd() * 3) | 0]);
  };
  for (const [px, pz] of [
    [150, 946],
    [395, 946],
    [395, 1234],
    [150, 1522],
    [395, 1810],
    [150, 2098],
  ] as const) {
    bwPlanter(px, pz, -0.75, true);
  }
  for (const [px, pz] of [
    [140, 2205],
    [405, 2205],
  ] as const) {
    bwPlanter(px, pz, -9.75, false);
    barkG.push(new THREE.CylinderGeometry(i2m(3), i2m(4.5), i2m(75), 6).translate(i2m(px), i2m(48), i2m(pz)));
    blob(southRnd, px, 92, pz, 17, '#4E6B3C');
    blob(southRnd, px, 82, pz, 13, '#57743F');
  }
  const bwPlanters = merged(
    bwPlanterG,
    new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.5, metalness: 0.45 }),
  );
  bwPlanters.castShadow = true;
  bwPlanters.receiveShadow = true;
  group.add(bwPlanters);

  // island oak + scenery oaks flanking the wings
  oak(21, 272.5, 2480, 6, 0.5, 1, 250, -40);
  oak(22, -680, 740, 8, -0.6, 0.5, 290, -60);
  oak(23, 950, 730, 6, 0.8, 0.3, 270, -50);
  oak(24, -520, 2320, 10, -0.8, 0.6, 300, -70);
  oak(25, 1080, 2260, 7, 0.7, 0.8, 260, -70);

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

export interface Atmosphere {
  skyMat: THREE.MeshBasicMaterial;
  valleyMat: THREE.MeshBasicMaterial;
  fog: THREE.Fog;
}

export function applyAtmosphere(scene: THREE.Scene): Atmosphere {
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

  return {
    skyMat: sky.material as THREE.MeshBasicMaterial,
    valleyMat: valley.material as THREE.MeshBasicMaterial,
    fog: scene.fog as THREE.Fog,
  };
}
