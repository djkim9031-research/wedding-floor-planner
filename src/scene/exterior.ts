import * as THREE from 'three';
import { tag } from '../render/tags';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { i2m, DECK_OAK_MOVE, DECK_PLANTER_SPOTS, DECK_POLY, DECK_TRUNKS, EAVE_Y, HALL_EAVE_Y, RIDGE_X, RIDGE_Y, type TrunkFootprint } from '../constants';
import { E_EAVE, N_OVER, S_OVER, W_EAVE } from './venue/hallRoof';
import type { Vec2 } from '../types';
import { pointInPolygon } from '../core/geometry';
import { barkTexture } from './textures';
import { registerFixtures, type FixtureDef } from './fixtures';
import {
  COAST_LIVE_OAK,
  CRAPE_MYRTLE,
  EUCALYPTUS,
  OLIVE,
  STONE_PINE,
  TreeBatch,
  autoTree,
  barkMaterial,
  batchMeshes,
  farVariant,
  leafMaterial,
  type LimbSpec,
  type TreeSpec,
} from './oak';
import {
  DECK_TILE_U_IN,
  DECK_TILE_V_IN,
  RAIL_TILE_U_IN,
  RAIL_TILE_V_IN,
  asphaltTextures,
  deckIpeTextures,
  groundTexture,
  ipeRailTextures,
  litterAtlasTexture,
  trailerSidingTexture,
} from './texturesExterior';

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

/** smooth 2-D value noise in [0, 1] */
function noise2(x: number, z: number): number {
  const h = (i: number, j: number) => fract(Math.sin(i * 127.1 + j * 311.7) * 43758.5453);
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sz;
}
const smoothstep = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deck walking surface, inches (a hair under the interior floor). */
export const DECK_TOP_Y = -0.4;
const DECK_SLAB_T = 12;

// ---------------------------------------------------------------------------
// Site grading. The venue sits on a knoll: the room, hallways and the south
// campus are one terrace; the Tree Deck is cantilevered off its north face
// and the ground falls away beneath it to a parking lot ~3.5 m below deck
// level (photo 01), then keeps dropping into the oak woodland.
// ---------------------------------------------------------------------------

/** Parking lot below the deck to the N/NE (inches, model frame). */
export const LOT_POLY: Vec2[] = [
  { x: -360, z: -1150 },
  { x: 1060, z: -1110 },
  { x: 1140, z: -1590 },
  { x: -320, z: -1650 },
];
export const LOT_Y = -150;

function distToPoly(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - ex * t, p.z - a.z - ez * t));
  }
  return best;
}

/** signed distance: negative inside */
function sdPoly(p: Vec2, poly: Vec2[]): number {
  const d = distToPoly(p, poly);
  return pointInPolygon(p, poly) ? -d : d;
}

function sdRect(x: number, z: number, x0: number, x1: number, z0: number, z1: number): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  const out = Math.hypot(dx, dz);
  if (out > 0) return out;
  return -Math.min(x - x0, x1 - x, z - z0, z1 - z);
}

/** Ground height (inches) at a model point. */
export function terrainY(x: number, z: number): number {
  const p = { x, z };
  // far skirt: beyond ~65 m the ground drops under the painted backdrop's
  // lower edge (the panorama draws behind everything, depth-less)
  const r = Math.hypot(x - 272.5, z - 299.5) * 0.0254;
  const skK = smoothstep(58, 82, r);
  const ySk = -39.37 * (11 + Math.max(0, r - 66) * 0.32);
  const skirt = (y: number, k = 1) => y + (Math.min(y, ySk) - y) * skK * k;
  // deck knoll: ground under the deck steps down northward, then falls away
  const dDeck = Math.max(0, sdPoly(p, DECK_POLY));
  const under = -30 - 40 * THREE.MathUtils.clamp(-z / 498, 0, 1);
  const yDeck = skirt(under - 95 * smoothstep(0, 420, dDeck) - 270 * smoothstep(420, 2300, dDeck));
  // campus terrace (grass boxes sit on top at −1"/−11"); only its outside
  // slopes join the skirt
  const dCampus = sdRect(x, z, -2100, 3400, 300, 2700);
  const yCampus = skirt((z < 1700 ? -4 : -14) - 330 * smoothstep(0, 1700, Math.max(0, dCampus)), smoothstep(0, 400, dCampus));
  // building block (hidden under floors)
  const dBldg = sdRect(x, z, -620, 720, -5, 700);
  const yBldg = skirt(-30 - 220 * smoothstep(0, 700, Math.max(0, dBldg)));
  let y = Math.max(yDeck, yCampus, yBldg);
  // cut the parking lot in flat, a touch below the asphalt
  const dLot = sdPoly(p, LOT_POLY);
  const w = 1 - smoothstep(50, 260, dLot);
  y = y + (LOT_Y - 3 - y) * w;
  return y;
}

// ---------------------------------------------------------------------------
// Helpers for oriented wood / metal pieces
// ---------------------------------------------------------------------------

/** Box with UVs in rail-tile units so the Ipe grain runs along `axis`. */
function grainBox(sx: number, sy: number, sz: number, axis: 'x' | 'y', uOff: number): Geo {
  const g = new THREE.BoxGeometry(i2m(sx), i2m(sy), i2m(sz));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) / i2m(1);
    const y = pos.getY(k) / i2m(1);
    const z = pos.getZ(k) / i2m(1);
    const ax = Math.abs(nor.getX(k));
    const ay = Math.abs(nor.getY(k));
    const along = axis === 'x' ? x : y;
    // across: the in-face coordinate that isn't the grain axis
    let across: number;
    if (axis === 'x') across = ay > 0.5 ? z : ax > 0.5 ? z : y;
    else across = ax > 0.5 ? z : ay > 0.5 ? z : x;
    uv.setXY(k, along / RAIL_TILE_U_IN + uOff, across / RAIL_TILE_V_IN + uOff * 0.37);
  }
  return g;
}

/** Place a local piece (built around the origin, run direction +x) at an
 * inch position, yawed so +x follows (dx, dz). */
function placeAlong(g: Geo, x: number, y: number, z: number, dx: number, dz: number): Geo {
  g.rotateY(Math.atan2(-dz, dx));
  g.translate(i2m(x), i2m(y), i2m(z));
  return g;
}

function ellipsePoints(t: TrunkFootprint, grow: number, n: number): Vec2[] {
  const a = THREE.MathUtils.degToRad(t.rotDeg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const lx = (t.rx + grow) * Math.cos(th);
    const lz = (t.rz + grow) * Math.sin(th);
    out.push({ x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c });
  }
  return out;
}

function insideTrunk(p: Vec2, grow: number): boolean {
  for (const t of DECK_TRUNKS) {
    const a = THREE.MathUtils.degToRad(t.rotDeg);
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a);
    const lz = dx * Math.sin(a) + dz * Math.cos(a);
    if ((lx / (t.rx + grow)) ** 2 + (lz / (t.rz + grow)) ** 2 < 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deck-oak skeleton (photos 03/04): trunk A leans ~38° west off the root
// crown, then bends into a massive near-horizontal limb reaching ~11 m west
// before S-curving up; trunk B rises nearly plumb behind it; stem C is the
// big upright east trunk. Points in inches, model frame.
// ---------------------------------------------------------------------------

export function deckOakSpec(): TreeSpec {
  const [A, B, C] = DECK_TRUNKS;
  const { x: ox, z: oz } = DECK_OAK_MOVE;
  const flare = (fp: TrunkFootprint) => ({ footprint: fp, deckY: DECK_TOP_Y, height: 44, clearance: 1.25 });
  const limbs: LimbSpec[] = [
    {
      // A — the leaning main trunk: ~35° off plumb toward the west, bending
      // at head height into the great west limb (photo 04)
      pts: [
        [A.x, -56, A.z],
        [A.x, DECK_TOP_Y, A.z],
        [A.x - 17, 24, A.z - 1],
        [A.x - 38, 48, A.z - 4],
        [A.x - 58, 70, A.z - 8],
        [A.x - 72, 84, A.z - 12],
      ],
      r: [12.5, 9.8, 9.4, 9, 8.6, 8.2],
      sprout: 1,
      flare: flare(A),
    },
    {
      // A-W: the massive limb — runs near-horizontal just over head height
      // WNW for ~5 m, then S-curves up and on west (~10 m reach, photos 03/04)
      pts: [
        [A.x - 66, 80, A.z - 11],
        [A.x - 110, 88, A.z - 26],
        [A.x - 156, 96, A.z - 44],
        [A.x - 192, 112, A.z - 58],
        [A.x - 214, 146, A.z - 66],
        [A.x - 222, 190, A.z - 66],
        [A.x - 236, 234, A.z - 58],
        [A.x - 262, 274, A.z - 56],
        [A.x - 300, 306, A.z - 60],
        [A.x - 350, 330, A.z - 66],
        [A.x - 400, 346, A.z - 70],
      ],
      r: [6.2, 5.8, 5.4, 5, 4.6, 4.3, 3.9, 3.4, 2.8, 2.2, 1.5],
      sprout: 0.18,
    },
    {
      // A-up: sinuous leader rising from the bend
      pts: [
        [A.x - 70, 82, A.z - 11],
        [A.x - 82, 124, A.z - 18],
        [A.x - 74, 172, A.z - 30],
        [A.x - 88, 222, A.z - 40],
        [A.x - 76, 276, A.z - 34],
        [A.x - 86, 336, A.z - 46],
        [A.x - 78, 396, A.z - 52],
      ],
      r: [6.4, 6, 5.5, 4.8, 3.9, 2.9, 1.9],
      sprout: 0.12,
    },
    {
      // A-NW: off the rising west limb, high out over the NW corner
      pts: [
        [A.x - 222, 190, A.z - 66],
        [A.x - 262, 228, A.z - 126],
        [A.x - 310, 258, A.z - 196],
        [A.x - 360, 282, A.z - 266],
        [A.x - 402, 298, A.z - 326],
      ],
      r: [3.6, 3.2, 2.7, 2.1, 1.5],
      sprout: 0.2,
    },
    {
      // A-S: off the west limb, climbing steeply over the covered bay
      pts: [
        [A.x - 110, 88, A.z - 26],
        [A.x - 130, 140, A.z + 10],
        [A.x - 150, 200, A.z + 60],
        [A.x - 170, 250, A.z + 120],
        [A.x - 190, 290, A.z + 190],
        [A.x - 206, 318, A.z + 260],
        [A.x - 218, 336, A.z + 330],
      ],
      r: [4, 3.7, 3.3, 2.8, 2.2, 1.7, 1.2],
      sprout: 0.3,
    },
    {
      // B — upright companion, gentle S
      pts: [
        [B.x, -56, B.z],
        [B.x, DECK_TOP_Y, B.z],
        [B.x + 4, 56, B.z - 4],
        [B.x - 4, 116, B.z - 12],
        [B.x + 6, 176, B.z - 22],
        [B.x, 236, B.z - 32],
        [B.x + 10, 296, B.z - 40],
        [B.x + 4, 356, B.z - 50],
        [B.x + 14, 416, B.z - 58],
        [B.x + 9, 470, B.z - 62],
      ],
      r: [9.5, 7.4, 7.1, 6.8, 6.4, 5.9, 5.2, 4.4, 3.3, 2.2],
      sprout: 0.32,
      flare: flare(B),
    },
    {
      pts: [
        [B.x + 6, 176, B.z - 22],
        [B.x - 5, 214, B.z - 90],
        [B.x - 17, 244, B.z - 170],
        [B.x - 35, 264, B.z - 250],
        [B.x - 57, 278, B.z - 330],
      ],
      r: [4.2, 3.7, 3, 2.3, 1.6],
    },
    {
      pts: [
        [B.x, 236, B.z - 32],
        [B.x + 63, 262, B.z - 42],
        [B.x + 133, 284, B.z - 54],
        [B.x + 211, 296, B.z - 64],
        [B.x + 283, 302, B.z - 76],
      ],
      r: [4, 3.5, 2.9, 2.2, 1.5],
    },
    {
      pts: [
        [B.x + 10, 296, B.z - 40],
        [B.x - 33, 334, B.z - 98],
        [B.x - 73, 372, B.z - 150],
        [B.x - 111, 410, B.z - 190],
      ],
      r: [3.4, 2.9, 2.3, 1.6],
    },
    {
      // C — massive upright east stem
      pts: [
        [C.x, -56, C.z],
        [C.x, DECK_TOP_Y, C.z],
        [C.x + 4, 70, C.z + 4],
        [C.x + 12, 140, C.z + 10],
        [C.x + 6, 210, C.z + 16],
        [C.x + 16, 280, C.z + 26],
        [C.x + 12, 350, C.z + 30],
        [C.x + 22, 420, C.z + 36],
        [C.x + 18, 480, C.z + 40],
      ],
      r: [12, 9.6, 9.2, 8.7, 8.1, 7.2, 6, 4.5, 3],
      sprout: 0.3,
      flare: flare(C),
    },
    {
      pts: [
        [C.x + 6, 210, C.z + 16],
        [C.x + 74, 234, C.z + 26],
        [C.x + 154, 254, C.z + 44],
        [C.x + 234, 264, C.z + 62],
        [C.x + 314, 270, C.z + 80],
      ],
      r: [4.8, 4.2, 3.6, 2.8, 1.9],
    },
    {
      pts: [
        [C.x + 16, 280, C.z + 26],
        [C.x + 34, 302, C.z + 94],
        [C.x + 52, 322, C.z + 174],
        [C.x + 64, 338, C.z + 254],
        [C.x + 74, 350, C.z + 328],
      ],
      r: [4, 3.4, 2.7, 2, 1.4],
    },
    {
      pts: [
        [C.x + 12, 350, C.z + 30],
        [C.x + 74, 380, C.z - 36],
        [C.x + 134, 404, C.z - 106],
        [C.x + 184, 420, C.z - 176],
      ],
      r: [3.4, 2.8, 2.2, 1.6],
    },
    {
      // C-N and A-N fill the middle storey north of the trunks, over the
      // rail (photo 04: foliage down to ~4–5 m there)
      pts: [
        [C.x + 12, 140, C.z + 10],
        [C.x - 10, 170, C.z - 80],
        [C.x - 30, 196, C.z - 170],
        [C.x - 60, 214, C.z - 260],
        [C.x - 90, 226, C.z - 340],
      ],
      r: [5, 4.4, 3.6, 2.6, 1.8],
    },
    {
      pts: [
        [A.x - 74, 172, A.z - 30],
        [A.x - 60, 196, A.z - 110],
        [A.x - 44, 216, A.z - 200],
        [A.x - 30, 230, A.z - 290],
      ],
      r: [3.6, 3.1, 2.4, 1.6],
    },
    {
      // C-SE and B-S carry the crown south over the covered bay
      pts: [
        [C.x + 16, 280, C.z + 26],
        [C.x + 80, 300, C.z + 110],
        [C.x + 150, 318, C.z + 190],
        [C.x + 210, 330, C.z + 262],
      ],
      r: [3.8, 3.2, 2.5, 1.8],
    },
    {
      pts: [
        [B.x, 236, B.z - 32],
        [B.x - 20, 270, B.z + 50],
        [B.x - 44, 300, B.z + 130],
        [B.x - 70, 324, B.z + 210],
        [B.x - 96, 340, B.z + 284],
      ],
      r: [3.8, 3.3, 2.7, 2, 1.4],
    },
    {
      pts: [
        [A.x - 86, 336, A.z - 46],
        [A.x - 40, 380, A.z + 40],
        [A.x + 10, 410, A.z + 124],
      ],
      r: [2.6, 2, 1.4],
    },
  ];
  const onDeck = (x: number, z: number) => pointInPolygon({ x, z }, DECK_POLY);
  return {
    limbs,
    // crown lobes were authored around the tree's first spot; they move with it
    crown: [
      { c: [140 + ox, 232, -300 + oz], r: [330, 162, 370] },
      { c: [400 + ox, 262, -350 + oz], r: [310, 184, 380] },
      { c: [640 + ox, 222, -330 + oz], r: [240, 150, 310] },
    ],
    reach: 1.3,
    // the hall roof (gable 144" eaves → 210" ridge, 3" deep, with its
    // overhangs): leaf cards hanging off branches above it stop short of it
    solid: (x, y, z) =>
      x > W_EAVE && x < E_EAVE && z > N_OVER && z < S_OVER && y < HALL_EAVE_Y + (RIDGE_Y - HALL_EAVE_Y) * (1 - Math.abs(x - RIDGE_X) / RIDGE_X) + 5,
    // clear headroom over the deck, and stay above the hall roof including
    // its covered-bay overhang (eaves −36…581, rake to z −72, plus a foot);
    // the deck near the building stays open below ~14'; the west half of the
    // crown sits high (sky under it in photo 03)
    floorY: (x, z) =>
      x > -48 && x < 593 && z > -84 && z < 659
        ? 250
        : x < 260 + ox
          ? 200
          : onDeck(x, z)
            ? z > -220
              ? 170
              : 100
            : 60,
  };
}

// ---------------------------------------------------------------------------
// The exterior
// ---------------------------------------------------------------------------

/** The deck oak's bunny and squirrel easter egg. */
const SHOW_CRITTERS = false;

export function buildExterior(): THREE.Group {
  const t0 = performance.now();
  const group = new THREE.Group();

  // -------------------------------------------------------------------------
  // Deck slab from the traced Tree Deck outline, scribed around the trunks,
  // top flush with the floor. Caps carry the Ipe boards (E-W runs); the
  // slab edges and trunk openings read as the Ipe fascia / cut ends.
  // -------------------------------------------------------------------------
  const ipe = deckIpeTextures();
  for (const t of [ipe.map, ipe.roughnessMap, ipe.normalMap]) t.repeat.set(1 / i2m(DECK_TILE_U_IN), 1 / i2m(DECK_TILE_V_IN));
  const rail = ipeRailTextures();
  const shape = new THREE.Shape();
  DECK_POLY.forEach((p, k) => {
    if (k === 0) shape.moveTo(i2m(p.x), -i2m(p.z));
    else shape.lineTo(i2m(p.x), -i2m(p.z));
  });
  shape.closePath();
  for (const t of DECK_TRUNKS) {
    const hole = new THREE.Path();
    ellipsePoints(t, 0, 48).forEach((p, k) => (k ? hole.lineTo(i2m(p.x), -i2m(p.z)) : hole.moveTo(i2m(p.x), -i2m(p.z))));
    hole.closePath();
    shape.holes.push(hole);
  }
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: i2m(DECK_SLAB_T), bevelEnabled: false, curveSegments: 1 });
  // rotate -90°: shape (x,-z) lands at world +z with the extrude cap facing UP
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, i2m(DECK_TOP_Y - DECK_SLAB_T), 0);
  const deckMat = tag(
    new THREE.MeshStandardMaterial({
      map: ipe.map,
      roughnessMap: ipe.roughnessMap,
      normalMap: ipe.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1,
      metalness: 0,
    }),
    'wood-deck',
    { clearcoat: 0.5, clearcoatRoughness: 0.2 },
    'deck',
  );
  const fasciaMap = rail.map.clone();
  fasciaMap.repeat.set(1 / i2m(RAIL_TILE_U_IN), 1 / i2m(RAIL_TILE_V_IN));
  fasciaMap.needsUpdate = true;
  const fasciaMat = tag(new THREE.MeshStandardMaterial({ map: fasciaMap, roughness: 0.55, metalness: 0 }), 'wood-rail', { clearcoat: 0.3 }, 'deckFascia');
  const deck = new THREE.Mesh(deckGeo, [deckMat, fasciaMat]);
  deck.receiveShadow = true;
  deck.castShadow = true;
  deck.name = 'deck';
  group.add(deck);

  // substructure seen from the slope/lot: 6×6 posts and a drop beam
  const subG: Geo[] = [];
  const outerRuns: [number, number, number, number][] = [
    [-176, -2, -176, -288],
    [-176, -288, 25, -496],
    [25, -496, 546, -496],
    [546, -496, 735, -288],
    [735, -288, 735, 143],
  ];
  for (const [x0, z0, x1, z1] of outerRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const nx = -dz;
    const nz = dx; // inward
    const n = Math.max(1, Math.round(len / 96));
    const beam = new THREE.BoxGeometry(i2m(len), i2m(9.5), i2m(3.5));
    beam.translate(0, i2m(DECK_TOP_Y - DECK_SLAB_T - 4.75), 0);
    subG.push(placeAlong(beam, (x0 + x1) / 2 + nx * 22, 0, (z0 + z1) / 2 + nz * 22, dx, dz));
    for (let k = 0; k <= n; k++) {
      const px = x0 + (x1 - x0) * (k / n) + nx * 22;
      const pz = z0 + (z1 - z0) * (k / n) + nz * 22;
      const top = DECK_TOP_Y - DECK_SLAB_T - 9;
      const bot = terrainY(px, pz) - 6;
      if (top - bot < 4) continue;
      subG.push(box(px - 2.75, px + 2.75, bot, top, pz - 2.75, pz + 2.75));
    }
  }
  const sub = merged(subG, tag(new THREE.MeshStandardMaterial({ color: 0x4a3b31, roughness: 0.9, metalness: 0 }), 'wood-rail', {}, 'deckFraming'));
  sub.castShadow = true;
  sub.receiveShadow = true;
  group.add(sub);

  buildRailing(group, rail);

  // -------------------------------------------------------------------------
  // Deck oak
  // -------------------------------------------------------------------------
  const planFade = { value: 0 };
  const deckOak = new TreeBatch(COAST_LIVE_OAK, true);
  deckOak.add(deckOakSpec(), 0xdec0a);
  const oakBarkMat = barkMaterial('oak', 'oakBark');
  const deckOakGroup = batchMeshes(deckOak, {
    bark: oakBarkMat,
    barkFine: barkMaterial('oak', 'deckOakBranches', { planFade: { uniform: planFade } }),
    leaves: leafMaterial('oak', 'deckOakLeaves', { planFade: { uniform: planFade } }),
    leavesRender: leafMaterial('oak', 'deckOakLeavesRender'),
  });
  deckOakGroup.name = 'deckOak';
  // plan view: dissolve the canopy and the finer branches when looking
  // straight down from above them, so the deck stays plannable (trunks and
  // the great limbs stay; shadows keep their dapple)
  const updateFade: THREE.Object3D['onBeforeRender'] = (_r, _s, cam) => {
    const e = cam.matrixWorld.elements;
    const lookDown = e[9]; // −forward.y
    planFade.value = smoothstep(10.5, 13.5, cam.position.y) * smoothstep(0.78, 0.94, lookDown);
  };
  for (const n of ['leaves-live', 'branches']) {
    const o = deckOakGroup.getObjectByName(`${COAST_LIVE_OAK.name}-${n}`);
    if (o) o.onBeforeRender = updateFade;
  }
  group.add(deckOakGroup);
  group.userData.deckOakStats = deckOak.stats;

  buildLitter(group);

  // -------------------------------------------------------------------------
  // Bronze planters (tapered square = 4-segment cylinder), each with a shrub.
  // -------------------------------------------------------------------------
  const foliageG: Geo[] = [];
  const foliageColors = ['#4C5A35', '#556340', '#47523A', '#5E6C44', '#66744A'];

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
      const vert = 0.78 + 0.42 * Math.min(1, Math.max(0, y / (i2m(r) * 1.6) + 0.5));
      const sh = (0.82 + fract(h * 7.31) * 0.33) * vert;
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
  for (const [px, pz] of DECK_PLANTER_SPOTS) {
    const g = new THREE.CylinderGeometry(i2m(13), i2m(10), i2m(30), 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(i2m(px), i2m(15), i2m(pz));
    planterG.push(g);
    blob(planterRnd, px, 40, pz, 15, foliageColors[1]);
  }
  const planters = merged(planterG, tag(new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.5, metalness: 0.45 }), 'metal-dark', {}, 'deckPlanters'));
  planters.castShadow = true;
  planters.receiveShadow = true;
  group.add(planters);

  // -------------------------------------------------------------------------
  // Surroundings: graded site, parking lot, trailer, slope planting, trees
  // -------------------------------------------------------------------------
  buildSurroundings(group, oakBarkMat);

  const barkG: Geo[] = [];
  const campusOaks = new TreeBatch(farVariant(COAST_LIVE_OAK));
  const islandOak = new TreeBatch({ ...COAST_LIVE_OAK, name: 'islandOak' });

  // -------------------------------------------------------------------------
  // South campus — neighboring masses ring two open courtyards off the
  // breezeway, entry court with the drop-off circle, dry-grass ground so the
  // massing sits on something. The court sits one terrace (10") below grade.
  // -------------------------------------------------------------------------
  const grass = merged(
    [box(-2100, 3400, -3, -1, 300, 1700), box(-2100, 3400, -13, -11, 1700, 2700)],
    tag(new THREE.MeshStandardMaterial({ color: 0xc9bfa3, roughness: 1, metalness: 0 }), 'ground', {}, 'dryGrass'),
  );
  grass.receiveShadow = true;
  group.add(grass);

  // terrace edge where the grade steps down to the court
  const ledge = merged(
    [box(-2100, 70, -13, -0.9, 1694, 1702), box(475, 3400, -13, -0.9, 1694, 1702)],
    tag(new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.95, metalness: 0 }), 'stone', {}, 'ledge'),
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
  const hip = (x0: number, x1: number, z0: number, z1: number, ridge = 200) => {
    wingWallG.push(box(x0, x1, -2, EAVE_Y, z0, z1));
    const ov = 20;
    const e0 = [x0 - ov, 106, z0 - ov];
    const e1 = [x1 + ov, 106, z0 - ov];
    const e2 = [x1 + ov, 106, z1 + ov];
    const e3 = [x0 - ov, 106, z1 + ov];
    if (x1 - x0 >= z1 - z0) {
      const zc = (z0 + z1) / 2;
      const ins = (z1 - z0) / 2;
      const r0 = [x0 + ins, ridge, zc];
      const r1 = [x1 - ins, ridge, zc];
      quad(e0, e1, r1, r0);
      quad(e3, e2, r1, r0);
      quad(e3, e0, r0, r0);
      quad(e1, e2, r1, r1);
    } else {
      // deep plan: ridge runs along z instead
      const xc = (x0 + x1) / 2;
      const ins = (x1 - x0) / 2;
      const r0 = [xc, ridge, z0 + ins];
      const r1 = [xc, ridge, z1 - ins];
      quad(e0, e3, r1, r0);
      quad(e1, e2, r1, r0);
      quad(e0, e1, r0, r0);
      quad(e3, e2, r1, r1);
    }
  };
  // masses traced off the satellite; corners interpenetrate for a merged read
  hip(-2000, -610, 380, 760); // north-west arm
  hip(700, 2300, 380, 760); // north-east arm
  hip(-2000, -470, 760, 1290); // west connector
  hip(-2000, 120, 1290, 1800); // south band west, clear of the canopy posts
  hip(405, 2300, 1290, 1800); // south band east
  hip(830, 2300, 760, 1290); // east connector
  hip(2300, 3300, 300, 1900, 230); // far-east block, a touch taller

  // a few dark openings on the faces seen from the courts and breezeway
  for (const wz of [900, 1030, 1160]) {
    winG.push(box(-470.6, -469.4, 40, 88, wz, wz + 52)); // west court, west wall
    winG.push(box(829.4, 830.6, 40, 88, wz, wz + 52)); // east court, east wall
  }
  for (const wx of [-430, -300, -170, -40]) {
    winG.push(box(wx, wx + 52, 40, 88, 1289.4, 1290.6)); // west court, south wall
  }
  for (const wx of [460, 600, 740]) {
    winG.push(box(wx, wx + 52, 40, 88, 1289.4, 1290.6)); // east court, south wall
  }
  for (const wx of [740]) {
    winG.push(box(wx, wx + 52, 40, 88, 759.4, 760.6)); // east court, north wall
  }
  for (const wz of [1410, 1550, 1690]) {
    winG.push(box(119.4, 120.6, 40, 88, wz, wz + 52)); // breezeway, south half
    winG.push(box(404.4, 405.6, 40, 88, wz, wz + 52));
  }

  const wingWalls = merged(wingWallG, tag(new THREE.MeshStandardMaterial({ color: 0xede8dd, roughness: 0.95, metalness: 0 }), 'stucco', {}, 'wingWalls'));
  wingWalls.castShadow = true;
  wingWalls.receiveShadow = true;
  const hipGeo = new THREE.BufferGeometry();
  hipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hipPos), 3));
  hipGeo.computeVertexNormals();
  const wingRoofs = new THREE.Mesh(
    hipGeo,
    tag(new THREE.MeshStandardMaterial({ color: 0x8b7365, roughness: 0.98, metalness: 0 }), 'generic', {}, 'wingRoofs'),
  );
  wingRoofs.castShadow = true;
  wingRoofs.receiveShadow = true;
  const wins = merged(winG, tag(new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.4, metalness: 0.1 }), 'generic', {}, 'wingWindows'));
  group.add(wingWalls, wingRoofs, wins);

  // drop-off circle with a planted center island
  const asphalt = new THREE.Mesh(
    new THREE.CylinderGeometry(i2m(260), i2m(260), i2m(1.2), 48).translate(i2m(272.5), i2m(-11.1), i2m(2020)),
    tag(new THREE.MeshStandardMaterial({ color: 0x6f6c68, roughness: 0.97, metalness: 0 }), 'asphalt', {}, 'dropoff'),
  );
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const curbMat = tag(new THREE.MeshStandardMaterial({ color: 0xb3ac9f, roughness: 0.9, metalness: 0 }), 'stone', {}, 'curb');
  const gap = 1.7; // curb ring opens where the walk feeds in from the north
  const curbGeo = new THREE.TorusGeometry(i2m(262), i2m(2.4), 6, 48, Math.PI * 2 - gap);
  curbGeo.rotateZ(-Math.PI / 2 + gap / 2);
  curbGeo.rotateX(Math.PI / 2);
  curbGeo.translate(i2m(272.5), i2m(-10.4), i2m(2020));
  const curb = new THREE.Mesh(curbGeo, curbMat);
  curb.castShadow = true;
  curb.receiveShadow = true;
  const islandCurb = new THREE.Mesh(
    new THREE.TorusGeometry(i2m(92), i2m(2.6), 6, 40).rotateX(Math.PI / 2).translate(i2m(272.5), i2m(-10.2), i2m(2020)),
    curbMat,
  );
  islandCurb.castShadow = true;
  islandCurb.receiveShadow = true;
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(i2m(90), i2m(90), i2m(2), 40).translate(i2m(272.5), i2m(-10), i2m(2020)),
    tag(new THREE.MeshStandardMaterial({ color: 0x6b5b49, roughness: 1, metalness: 0 }), 'soil', {}, 'islandSoil'),
  );
  soil.receiveShadow = true;
  group.add(curb, islandCurb, soil);

  const southRnd = mulberry32(0xb42);
  for (const [sx, sz] of [
    [210, 1985],
    [330, 1970],
    [225, 2065],
    [320, 2060],
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
    [395, 1350],
    [150, 1638],
  ] as const) {
    bwPlanter(px, pz, -0.75, true);
  }
  for (const [px, pz] of [
    [140, 1745],
    [405, 1745],
  ] as const) {
    bwPlanter(px, pz, -9.75, false);
    barkG.push(new THREE.CylinderGeometry(i2m(3), i2m(4.5), i2m(75), 6).translate(i2m(px), i2m(48), i2m(pz)));
    blob(southRnd, px, 92, pz, 17, '#4E6B3C');
    blob(southRnd, px, 82, pz, 13, '#57743F');
  }
  // -------------------------------------------------------------------------
  // Open courtyards flanking the breezeway's north half — patio court west,
  // garden court east. Court planters ride the breezeway-planter merge.
  // -------------------------------------------------------------------------
  const pavers = merged(
    [
      box(-470, 100, -2, -0.5, 815, 1250),
      // east court: kept off the lounge's paving (the walk's terrace, x
      // 469–560, and the walk beside it, both to z 890)
      box(375, 830, -2, -0.5, 890, 1250),
      box(560, 830, -2, -0.5, 815, 890),
    ],
    tag(new THREE.MeshStandardMaterial({ color: 0xcfc5b2, roughness: 0.95, metalness: 0 }), 'stone', {}, 'walkPavers'),
  );
  pavers.receiveShadow = true;
  group.add(pavers);

  // west court: white patio sets kept toward the west side
  const patioG: Geo[] = [];
  for (const [px, pz] of [
    [-400, 920],
    [-360, 1160],
    [-230, 1030],
    [-160, 1180],
  ] as const) {
    patioG.push(new THREE.CylinderGeometry(i2m(24), i2m(24), i2m(29), 12).translate(i2m(px), i2m(14.5), i2m(pz)));
    for (const [dx, dz] of [
      [-40, 0],
      [40, 0],
      [0, -40],
      [0, 40],
    ] as const) {
      const cx = px + dx;
      const cz = pz + dz;
      patioG.push(box(cx - 8, cx + 8, 0, 17, cz - 8, cz + 8)); // seat
      if (dx) patioG.push(box(cx + (dx < 0 ? -8 : 5), cx + (dx < 0 ? -5 : 8), 17, 34, cz - 8, cz + 8));
      else patioG.push(box(cx - 8, cx + 8, 17, 34, cz + (dz < 0 ? -8 : 5), cz + (dz < 0 ? -5 : 8)));
    }
  }
  const patio = merged(patioG, tag(new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, metalness: 0 }), 'stone', {}, 'patio'));
  patio.castShadow = true;
  patio.receiveShadow = true;
  group.add(patio);

  // low hedge run along the west court's south edge
  for (let hx = -430; hx <= 50; hx += 80) {
    blob(southRnd, hx, 8, 1218, 16, foliageColors[1]);
  }

  // east court: three planting beds, each with a few foliage blobs
  const beds = merged(
    [box(440, 660, 0, 8, 890, 980), box(680, 800, 0, 8, 890, 980), box(440, 660, 0, 8, 1130, 1220)],
    tag(new THREE.MeshStandardMaterial({ color: 0x5c4a37, roughness: 1, metalness: 0 }), 'soil', {}, 'beds'),
  );
  beds.castShadow = true;
  beds.receiveShadow = true;
  group.add(beds);
  for (const [bx, bz] of [
    [480, 935],
    [555, 928],
    [625, 940],
    [705, 935],
    [745, 942],
    [780, 930],
    [485, 1175],
    [560, 1182],
    [630, 1170],
  ] as const) {
    blob(southRnd, bx, 20, bz, 14, foliageColors[(southRnd() * 3) | 0]);
  }

  // small central fountain: basin + pedestal, water discs on both
  const fountain = merged(
    [
      new THREE.CylinderGeometry(i2m(40), i2m(44), i2m(14), 16).translate(i2m(600), i2m(7), i2m(1030)),
      new THREE.CylinderGeometry(i2m(12), i2m(15), i2m(28), 12).translate(i2m(600), i2m(28), i2m(1030)),
    ],
    curbMat,
  );
  fountain.castShadow = true;
  fountain.receiveShadow = true;
  const water = merged(
    [
      new THREE.CylinderGeometry(i2m(34), i2m(34), i2m(1.5), 16).translate(i2m(600), i2m(12), i2m(1030)),
      new THREE.CylinderGeometry(i2m(16), i2m(16), i2m(1.5), 12).translate(i2m(600), i2m(42.5), i2m(1030)),
    ],
    tag(new THREE.MeshStandardMaterial({ color: 0x5f8fa8, roughness: 0.15, metalness: 0.1 }), 'generic', {}, 'fountainWater'),
  );
  water.receiveShadow = true;
  group.add(fountain, water);

  // court planters: two on the patio court, one in the garden court
  bwPlanter(-440, 855, -0.5, true);
  bwPlanter(55, 855, -0.5, true);
  bwPlanter(790, 860, -0.5, true);

  const bwPlanters = merged(
    bwPlanterG,
    tag(new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.5, metalness: 0.45 }), 'metal-dark', {}, 'bwPlanters'),
  );
  bwPlanters.castShadow = true;
  bwPlanters.receiveShadow = true;
  group.add(bwPlanters);

  // island oak + scenery oaks flanking the wings (same generator as the
  // deck oak; the far ones in the cheap variant)
  // limbed up so the entry view (#cam=entry) looks under its crown
  islandOak.add({ ...autoTree(COAST_LIVE_OAK, { x: 272.5, z: 2020, y: -11, height: 330, spread: 150, seed: 21 }), floorY: () => 160 }, 21);
  for (const [s, x, z, h, sp] of [
    [22, -430, 1150, 330, 220],
    [23, 740, 1170, 300, 200],
    [24, -520, 1860, 340, 240],
    [25, 1080, 1800, 310, 230],
  ] as const) {
    campusOaks.add(autoTree(COAST_LIVE_OAK, { x, z, y: Math.max(-4, terrainY(x, z)), height: h, spread: sp, seed: s }), s);
  }
  group.add(batchMeshes(islandOak, { bark: oakBarkMat, leaves: sharedLeafMat('oak') }));
  group.add(batchMeshes(campusOaks, { bark: oakBarkMat, leaves: sharedLeafMat('oak') }));

  const barkTex = barkTexture();
  barkTex.repeat.set(2, 7);
  const bark = merged(barkG, tag(new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, metalness: 0 }), 'bark', {}, 'palmBark'));
  bark.castShadow = true;
  const foliage = merged(
    foliageG,
    tag(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }), 'foliage', { translucency: 0.3 }, 'shrubFoliage'),
  );
  foliage.castShadow = true;
  group.add(bark, foliage);



  // -------------------------------------------------------------------------
  // Easter egg: a bunny and a squirrel playing by the deck oak. Left out of
  // the scene for now (the couple's setup views for the coordinator).
  // -------------------------------------------------------------------------
  const critters = new THREE.Group();
  const bunnyFur = tag(new THREE.MeshStandardMaterial({ color: 0xa29384, roughness: 0.95 }), 'generic', {}, 'bunnyFur');
  const bunnyWhite = tag(new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.95 }), 'generic', {}, 'bunnyWhite');
  const squirrelFur = tag(new THREE.MeshStandardMaterial({ color: 0x8a5636, roughness: 0.95 }), 'generic', {}, 'squirrelFur');
  const squirrelTail = tag(new THREE.MeshStandardMaterial({ color: 0x9c6a44, roughness: 0.98 }), 'generic', {}, 'squirrelTail');

  const part = (
    parent: THREE.Group,
    mat: THREE.Material,
    r: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(i2m(r), 14, 12), mat);
    m.position.set(i2m(x), i2m(y), i2m(z));
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // bunny, sitting up mid-game (~9" tall) — faces +z
  const bunny = new THREE.Group();
  part(bunny, bunnyFur, 4.2, 0, 4, 0, 1, 0.9, 1.25); // body
  part(bunny, bunnyWhite, 3.1, 0, 3.4, 0.8, 0.95, 0.8, 1); // belly
  part(bunny, bunnyFur, 2.5, 0, 8, 2.6); // head
  part(bunny, bunnyWhite, 1.3, 0, 4.6, -5); // tail
  for (const sx of [-1, 1]) {
    const ear = part(bunny, bunnyFur, 1, sx * 1.2, 11.6, 1.6, 0.55, 2.4, 0.7);
    ear.rotation.set(-0.15, 0, sx * 0.18);
    part(bunny, bunnyFur, 1, sx * 1.7, 1.2, 2.8, 1, 0.6, 1.4); // front paws
  }
  bunny.position.set(i2m(352 + DECK_OAK_MOVE.x), i2m(DECK_TOP_Y), i2m(-262 + DECK_OAK_MOVE.z));
  bunny.rotation.y = Math.PI + 0.5; // looking toward the squirrel
  critters.add(bunny);

  // squirrel, mid-pounce with the tail arced high (~7" + tail) — faces +z
  const squirrel = new THREE.Group();
  const sqBody = part(squirrel, squirrelFur, 3, 0, 3.4, 0, 1, 1, 1.35);
  sqBody.rotation.x = -0.25; // pouncing forward
  part(squirrel, squirrelFur, 2.1, 0, 6.2, 3.2); // head
  for (const sx of [-1, 1]) {
    part(squirrel, squirrelFur, 0.7, sx * 1.1, 8, 2.9, 0.8, 1.2, 0.6); // ears
    part(squirrel, squirrelFur, 0.8, sx * 1.4, 1, 3.4, 1, 0.7, 1.3); // front paws
  }
  part(squirrel, squirrelTail, 1.9, 0, 3, -4.4, 0.8, 1, 0.9);
  part(squirrel, squirrelTail, 2.5, 0, 7, -5.8, 0.85, 1.1, 0.85);
  part(squirrel, squirrelTail, 2, 0, 10.6, -4.6, 0.75, 1, 0.75);
  squirrel.position.set(i2m(398 + DECK_OAK_MOVE.x), i2m(DECK_TOP_Y), i2m(-290 + DECK_OAK_MOVE.z));
  squirrel.rotation.y = Math.PI + 3.7; // facing back toward the bunny
  critters.add(squirrel);

  if (SHOW_CRITTERS) group.add(critters);

  retireLegacyLawn(group);
  group.userData.buildMs = Math.round(performance.now() - t0);
  return group;
}

// ---------------------------------------------------------------------------
// Shared foliage materials (one per leaf kind)
// ---------------------------------------------------------------------------

const leafMats = new Map<string, THREE.MeshStandardMaterial>();
function sharedLeafMat(kind: Parameters<typeof leafMaterial>[0]): THREE.MeshStandardMaterial {
  let m = leafMats.get(kind);
  if (!m) {
    m = leafMaterial(kind, `${kind}Leaves`);
    leafMats.set(kind, m);
  }
  return m;
}

/** The terrain replaces the old flat lawn disc (atmosphere.ts builds one at
 * y −0.55 m that would bury the parking lot and the slope under the deck).
 * Hide it if it shows up; a no-op once atmosphere.ts stops creating it. */
function retireLegacyLawn(group: THREE.Group): void {
  const hide = (o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.Material | undefined;
    if (m.isMesh && mat && !Array.isArray(mat) && mat.name === 'ground__lawn') m.visible = false;
  };
  group.addEventListener('added', () => {
    const scene = group.parent;
    if (!scene) return;
    scene.children.forEach(hide);
    scene.addEventListener('childadded', (e) => hide((e as unknown as { child: THREE.Object3D }).child));
  });
}

// ---------------------------------------------------------------------------
// Cable railing (photo 01): 42" high, 4½" Ipe posts ~5' o.c. with a 5½×1½
// Ipe cap, twelve 3/16" stainless cables on 3" centres, flat stainless
// pickets on base plates midway between posts, tensioner studs at run ends,
// and warm LED pucks on the inner face of alternate posts.
// ---------------------------------------------------------------------------

const RAIL_RUNS: [number, number, number, number][] = [
  [-4, -2, -176, -2], // west overhang in front of the building
  [-176, -2, -176, -288], // west flank
  [-176, -288, 25, -496], // NW chamfer
  [25, -496, 546, -496], // top edge
  [546, -496, 735, -288], // NE chamfer
  [735, -288, 735, 143], // east flank
  [735, 143, 593, 143], // wrap south end
  [593, 143, 553, 77], // wrap inner diagonal
];

export const RAIL_H = 42;
const POST_W = 4.5;
const POST_INSET = 3;
const CAP_W = 5.5;
const CAP_T = 1.5;
const CABLES = 12;
const CABLE_Y0 = 4;
const CABLE_PITCH = 3;
const PUCK_Y = 26;

function buildRailing(group: THREE.Group, rail: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture }): void {
  const rnd = mulberry32(0x7a11);
  const y0 = DECK_TOP_Y;
  const capBot = y0 + RAIL_H - CAP_T;

  // posts: run endpoints are shared corners; inset toward the deck
  interface Post {
    x: number;
    z: number;
    nx: number;
    nz: number;
    dx: number;
    dz: number;
  }
  const posts: Post[] = [];
  const runPosts: Post[][] = [];
  const findPost = (x: number, z: number) => posts.find((q) => Math.abs(q.x - x) < 1.5 && Math.abs(q.z - z) < 1.5);
  const runs = RAIL_RUNS.map(([x0, z0, x1, z1]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    return { x0, z0, x1, z1, len, dx, dz, nx: -dz, nz: dx };
  });
  runs.forEach((r, ri) => {
    const prev = runs.find((q) => Math.abs(q.x1 - r.x0) < 1 && Math.abs(q.z1 - r.z0) < 1);
    const next = runs.find((q) => Math.abs(q.x0 - r.x1) < 1 && Math.abs(q.z0 - r.z1) < 1);
    const corner = (x: number, z: number, o: typeof r | undefined) => {
      if (!o) return { x: x + r.nx * POST_INSET, z: z + r.nz * POST_INSET, nx: r.nx, nz: r.nz };
      const sx = r.nx + o.nx;
      const sz = r.nz + o.nz;
      const k = POST_INSET / (1 + r.nx * o.nx + r.nz * o.nz);
      const l = Math.hypot(sx, sz) || 1;
      return { x: x + sx * k, z: z + sz * k, nx: sx / l, nz: sz / l };
    };
    const a = corner(r.x0, r.z0, prev);
    const b = corner(r.x1, r.z1, next);
    const n = Math.max(1, Math.round(r.len / 60));
    const list: Post[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const end = k === 0 ? a : k === n ? b : null;
      let p = findPost(x, z);
      if (!p) {
        p = { x, z, nx: end ? end.nx : r.nx, nz: end ? end.nz : r.nz, dx: r.dx, dz: r.dz };
        posts.push(p);
      }
      list.push(p);
    }
    runPosts[ri] = list;
  });

  const postG: Geo[] = [];
  const capG: Geo[] = [];
  for (const p of posts) {
    const g = grainBox(POST_W, capBot - y0, POST_W, 'y', rnd());
    g.translate(0, i2m((capBot - y0) / 2), 0);
    postG.push(placeAlong(g, p.x, y0, p.z, p.dx, p.dz));
  }
  runs.forEach((r, ri) => {
    const list = runPosts[ri];
    const a = list[0];
    const b = list[list.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) + CAP_W;
    const g = grainBox(len, CAP_T, CAP_W, 'x', rnd());
    g.translate(0, i2m(CAP_T / 2), 0);
    capG.push(placeAlong(g, (a.x + b.x) / 2, capBot, (a.z + b.z) / 2, r.dx, r.dz));
  });
  const railMat = tag(
    new THREE.MeshStandardMaterial({ map: rail.map, normalMap: rail.normalMap, roughness: 0.45, metalness: 0 }),
    'wood-rail',
    { clearcoat: 0.4, clearcoatRoughness: 0.3 },
    'railIpe',
  );
  const postMesh = merged(postG, railMat);
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  postMesh.name = 'railPosts';
  const capMesh = merged(capG, railMat);
  capMesh.castShadow = true;
  capMesh.receiveShadow = true;
  capMesh.name = 'railCap';
  group.add(postMesh, capMesh);

  // stainless: cables, pickets + base plates, tensioner studs
  const steelG: Geo[] = [];
  const cableR = 0.09375; // 3/16" dia
  runs.forEach((r, ri) => {
    const list = runPosts[ri];
    const a = list[0];
    const b = list[list.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let c = 0; c < CABLES; c++) {
      const g = new THREE.CylinderGeometry(i2m(cableR), i2m(cableR), i2m(len), 6, 1, true);
      g.rotateZ(Math.PI / 2);
      steelG.push(placeAlong(g, (a.x + b.x) / 2, y0 + CABLE_Y0 + c * CABLE_PITCH, (a.z + b.z) / 2, r.dx, r.dz));
    }
    // pickets midway between posts
    for (let k = 0; k < list.length - 1; k++) {
      const mx = (list[k].x + list[k + 1].x) / 2;
      const mz = (list[k].z + list[k + 1].z) / 2;
      const bar = new THREE.BoxGeometry(i2m(0.375), i2m(capBot - y0 - 0.25), i2m(1.5));
      bar.translate(0, i2m((capBot - y0 + 0.25) / 2), 0);
      steelG.push(placeAlong(bar, mx, y0, mz, r.dx, r.dz));
      const plate = new THREE.BoxGeometry(i2m(3), i2m(0.25), i2m(3));
      plate.translate(0, i2m(0.125), 0);
      steelG.push(placeAlong(plate, mx, y0, mz, r.dx, r.dz));
    }
    // tensioner studs where cable runs end: the outer faces of the corner
    // posts, and one face of every 4th post (cables run ≤ ~20' per segment)
    const terminations: [Post, number][] = [
      [a, -1],
      [b, 1],
    ];
    for (let k = 4; k < list.length - 2; k += 4) terminations.push([list[k], -1]);
    for (const [p, sgn] of terminations) {
      for (let c = 0; c < CABLES; c++) {
        const stud = new THREE.CylinderGeometry(i2m(0.22), i2m(0.22), i2m(1.4), 6);
        stud.rotateZ(Math.PI / 2);
        stud.translate(i2m(sgn * (POST_W / 2 + 0.6)), 0, 0);
        steelG.push(placeAlong(stud, p.x, y0 + CABLE_Y0 + c * CABLE_PITCH, p.z, r.dx, r.dz));
        const nut = new THREE.CylinderGeometry(i2m(0.34), i2m(0.34), i2m(0.3), 6);
        nut.rotateZ(Math.PI / 2);
        nut.translate(i2m(sgn * (POST_W / 2 + 0.15)), 0, 0);
        steelG.push(placeAlong(nut, p.x, y0 + CABLE_Y0 + c * CABLE_PITCH, p.z, r.dx, r.dz));
      }
    }
  });
  const steel = merged(
    steelG,
    tag(new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.28, metalness: 1 }), 'metal-stainless', {}, 'railSteel'),
  );
  steel.castShadow = true;
  steel.name = 'railSteel';
  group.add(steel);

  // LED pucks on the inner face of alternate posts (skip the building-side
  // posts of the west overhang run: they face the hall, not the deck)
  const trimG: Geo[] = [];
  const lensG: Geo[] = [];
  const lensMat = tag(
    new THREE.MeshStandardMaterial({ color: 0x2a2520, emissive: 0xffb872, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0 }),
    'emitter-led',
    { luminance: 20000, castShadow: false },
    'deckPuckLens',
  );
  const trimMat = tag(new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.38, metalness: 0.85 }), 'metal-dark', {}, 'deckPuckTrim');
  const fixtures: FixtureDef[] = [];
  posts.forEach((p, k) => {
    if (k % 2) return;
    const face = POST_W / 2;
    const trim = new THREE.CylinderGeometry(i2m(1.375), i2m(1.375), i2m(0.3), 20);
    trim.rotateZ(Math.PI / 2); // axis along +x (local "inward" after the yaw)
    trim.translate(i2m(face + 0.15), 0, 0);
    trimG.push(placeAlong(trim, p.x, y0 + PUCK_Y, p.z, p.nx, p.nz));
    const lens = new THREE.CylinderGeometry(i2m(0.95), i2m(0.95), i2m(0.12), 20);
    lens.rotateZ(Math.PI / 2);
    lens.translate(i2m(face + 0.34), 0, 0);
    lensG.push(placeAlong(lens, p.x, y0 + PUCK_Y, p.z, p.nx, p.nz));
    const lx = p.x + p.nx * (face + 0.4);
    const lz = p.z + p.nz * (face + 0.4);
    fixtures.push({
      id: `deck-puck-${fixtures.length}`,
      kind: 'spot',
      group: 'deck',
      posIn: [lx, y0 + PUCK_Y, lz],
      aimIn: [lx + p.nx * 30, y0, lz + p.nz * 30],
      cct: 2700,
      intensityCd: 18,
      beamDeg: 110,
      radiusIn: 1.2,
      lensMaterial: lensMat.name,
      nightOnly: true,
    });
  });
  const trims = merged(trimG, trimMat);
  trims.name = 'deckPuckTrims';
  const lenses = merged(lensG, lensMat);
  lenses.name = 'deckPuckLenses';
  lenses.castShadow = false;
  group.add(trims, lenses);
  registerFixtures(fixtures);
  group.userData.deckPucks = fixtures.length;
}

// ---------------------------------------------------------------------------
// Acorn + leaf litter on the boards, densest under the canopy (photos 03/04)
// ---------------------------------------------------------------------------

function buildLitter(group: THREE.Group): void {
  const rnd = mulberry32(0xac04);
  const minX = -178;
  const maxX = 737;
  const minZ = -498;
  const maxZ = 145;
  // acorns and leaves fall under the crown (centred on the oak, wherever it stands)
  const canopy = (x: number, z: number) =>
    Math.exp(-(((x - 380 - DECK_OAK_MOVE.x) / 330) ** 2 + ((z + 340 - DECK_OAK_MOVE.z) / 260) ** 2));
  const sample = (): Vec2 => {
    for (;;) {
      const p = { x: minX + rnd() * (maxX - minX), z: minZ + rnd() * (maxZ - minZ) };
      if (!pointInPolygon(p, DECK_POLY) || insideTrunk(p, 2)) continue;
      // hug the rail line a little (swept against the posts)
      if (rnd() < 0.2 + 0.8 * canopy(p.x, p.z)) return p;
    }
  };

  const acorn = (out: { pos: number[]; col: number[]; idx: number[] }, x: number, z: number) => {
    const yaw = rnd() * Math.PI * 2;
    const L = 0.9 + rnd() * 0.5;
    const R = 0.28 + rnd() * 0.08;
    const cx = Math.cos(yaw);
    const cz = Math.sin(yaw);
    const base = out.pos.length / 3;
    const y = DECK_TOP_Y + R * 0.9;
    const tip = [x + cx * L * 0.5, y, z + cz * L * 0.5];
    const cap = [x - cx * L * 0.5, y, z - cz * L * 0.5];
    const ring: number[][] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const px = -cz * Math.cos(a) * R;
      const pz = cx * Math.cos(a) * R;
      ring.push([x - cx * L * 0.1 + px, y + Math.sin(a) * R, z - cz * L * 0.1 + pz]);
    }
    const brown = [0.42 + rnd() * 0.12, 0.3 + rnd() * 0.08, 0.16];
    for (const p of [tip, cap, ...ring]) out.pos.push(i2m(p[0]), i2m(p[1]), i2m(p[2]));
    out.col.push(...brown, 0.22, 0.17, 0.11, ...brown, ...brown, ...brown, ...brown);
    for (let k = 0; k < 4; k++) {
      const a = base + 2 + k;
      const b = base + 2 + ((k + 1) % 4);
      out.idx.push(base, b, a, base + 1, a, b);
    }
  };
  const leaf = (out: { pos: number[]; uv: number[]; idx: number[] }, x: number, z: number) => {
    const yaw = rnd() * Math.PI * 2;
    const s = 1.4 + rnd() * 1.2;
    const cx = Math.cos(yaw) * s;
    const cz = Math.sin(yaw) * s;
    const y = DECK_TOP_Y + 0.08 + rnd() * 0.05;
    const base = out.pos.length / 3;
    const cell = (rnd() * 16) | 0;
    const u0 = (cell % 4) / 4;
    const v0 = ((cell / 4) | 0) / 4;
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      out.pos.push(i2m(x + a * cx - b * cz), i2m(y + (a * b > 0 ? 0.08 : 0)), i2m(z + a * cz + b * cx));
      out.uv.push(u0 + ((a + 1) / 2) * 0.25, v0 + ((b + 1) / 2) * 0.25);
    }
    out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  const acornMat = tag(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }), 'bark', {}, 'acorns');
  const litterMat = tag(
    new THREE.MeshStandardMaterial({ map: litterAtlasTexture(), alphaTest: 0.5, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    'foliage',
    { translucency: 0.1 },
    'leafLitter',
  );
  const mk = (nAcorn: number, nLeaf: number, lod: 'render' | null, name: string) => {
    const a = { pos: [] as number[], col: [] as number[], idx: [] as number[] };
    const l = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    for (let i = 0; i < nAcorn; i++) {
      const p = sample();
      acorn(a, p.x, p.z);
    }
    for (let i = 0; i < nLeaf; i++) {
      const p = sample();
      leaf(l, p.x, p.z);
    }
    const ga = new THREE.BufferGeometry();
    ga.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    ga.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    ga.setIndex(a.idx);
    ga.computeVertexNormals();
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
    gl.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
    gl.setIndex(l.idx);
    gl.computeVertexNormals();
    const ma = new THREE.Mesh(ga, acornMat);
    const ml = new THREE.Mesh(gl, litterMat);
    ma.name = `${name}-acorns`;
    ml.name = `${name}-leaves`;
    for (const m of [ma, ml]) {
      m.receiveShadow = true;
      if (lod) {
        m.userData.render = { lod };
        m.visible = false;
      }
      group.add(m);
    }
  };
  mk(1300, 700, null, 'litter');
  mk(3200, 2400, 'render', 'litterRender');
}

// ---------------------------------------------------------------------------
// Surroundings (photos 01/03/04)
// ---------------------------------------------------------------------------

function buildSurroundings(group: THREE.Group, oakBarkMat: THREE.Material): void {
  const rnd = mulberry32(0x5e7);

  // --- terrain: polar grid around the room centre, fine near, coarse far ---
  const cx = 272.5;
  const cz = 299.5;
  const radii: number[] = [];
  for (let r = 0.5; r < 34; r += 1.0) radii.push(r);
  for (let r = 34; r < 62; r += 1.6) radii.push(r);
  for (let r = 62; r < 86; r += 3) radii.push(r);
  radii.push(96, 112, 135, 165, 205, 260);
  const segs = 192;
  const tpos: number[] = [];
  const tcol: number[] = [];
  const tuv: number[] = [];
  const tidx: number[] = [];
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i] / 0.0254;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = terrainY(x, z);
      tpos.push(i2m(x), i2m(y), i2m(z));
      tuv.push(i2m(x) / 3.05, i2m(z) / 3.05);
      // mulch/leaf litter darker and browner under the deck and the oaks,
      // drier grass on open ground
      // dry summer grass, patches of ivy/ground cover, leaf mulch under the
      // deck and near the oaks
      const dDeck = Math.max(0, sdPoly({ x, z }, DECK_POLY));
      const ivy = smoothstep(0.52, 0.72, noise2(x * 0.0035, z * 0.0035));
      const mulch = Math.max(1 - smoothstep(0, 300, dDeck), 0.6 * smoothstep(0.55, 0.8, noise2(x * 0.006 + 17, z * 0.006 - 9)));
      const n = 0.9 + 0.2 * noise2(x * 0.03, z * 0.03);
      const rgb = [0.78, 0.7, 0.5].map((dry, k) => {
        const g = dry + ([0.36, 0.46, 0.27][k] - dry) * ivy;
        return (g + ([0.46, 0.38, 0.29][k] - g) * mulch) * n;
      });
      const shade = 0.7 + 0.3 * smoothstep(0, 200, dDeck);
      tcol.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
    }
  }
  for (let i = 0; i < radii.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      tidx.push(a, b, c, b, d, c);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tg.setIndex(tidx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(
    tg,
    tag(new THREE.MeshStandardMaterial({ map: groundTexture(), vertexColors: true, roughness: 1, metalness: 0 }), 'ground', {}, 'terrain'),
  );
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  group.add(terrain);

  // --- parking lot ---------------------------------------------------------
  const lotShape = new THREE.Shape(LOT_POLY.map((p) => new THREE.Vector2(i2m(p.x), -i2m(p.z))));
  const lotGeo = new THREE.ShapeGeometry(lotShape);
  lotGeo.rotateX(-Math.PI / 2);
  lotGeo.translate(0, i2m(LOT_Y), 0);
  const asph = asphaltTextures();
  asph.map.repeat.set(1 / i2m(160), 1 / i2m(160));
  asph.roughnessMap.repeat.copy(asph.map.repeat);
  const lot = new THREE.Mesh(
    lotGeo,
    tag(new THREE.MeshStandardMaterial({ map: asph.map, roughnessMap: asph.roughnessMap, roughness: 1, metalness: 0 }), 'asphalt', {}, 'parkingLot'),
  );
  lot.receiveShadow = true;
  lot.name = 'parkingLot';
  group.add(lot);

  // curbs around the lot
  const curbG: Geo[] = [];
  for (let i = 0; i < LOT_POLY.length; i++) {
    const a = LOT_POLY[i];
    const b = LOT_POLY[(i + 1) % LOT_POLY.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const g = new THREE.BoxGeometry(i2m(len + 6), i2m(7), i2m(6));
    g.translate(0, i2m(1.5), 0);
    curbG.push(placeAlong(g, (a.x + b.x) / 2, LOT_Y, (a.z + b.z) / 2, (b.x - a.x) / len, (b.z - a.z) / len));
  }
  const curbs = merged(curbG, tag(new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.92, metalness: 0 }), 'stone', {}, 'lotCurb'));
  curbs.receiveShadow = true;
  group.add(curbs);

  // angled stalls (60°) along the near and far rows, one ADA stall + aisle
  const stripeG: Geo[] = [];
  const adaG: Geo[] = [];
  const quad = (out: Geo[], pts: Vec2[], y: number) => {
    const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(i2m(p.x), -i2m(p.z))));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    g.translate(0, i2m(y), 0);
    out.push(g);
  };
  const stripe = (p: Vec2, dir: Vec2, len: number, w: number, y = LOT_Y + 0.35) => {
    const nx = -dir.z * (w / 2);
    const nz = dir.x * (w / 2);
    quad(stripeG, [
      { x: p.x + nx, z: p.z + nz },
      { x: p.x + dir.x * len + nx, z: p.z + dir.z * len + nz },
      { x: p.x + dir.x * len - nx, z: p.z + dir.z * len - nz },
      { x: p.x - nx, z: p.z - nz },
    ], y);
  };
  const stripeTo = (out: Geo[], p: Vec2, dir: Vec2, len: number, w: number, y: number) => {
    const nx = -dir.z * (w / 2);
    const nz = dir.x * (w / 2);
    quad(out, [
      { x: p.x + nx, z: p.z + nz },
      { x: p.x + dir.x * len + nx, z: p.z + dir.z * len + nz },
      { x: p.x + dir.x * len - nx, z: p.z + dir.z * len - nz },
      { x: p.x - nx, z: p.z - nz },
    ], y);
  };
  const row = (a: Vec2, b: Vec2, inward: 1 | -1, from: number, to: number, ada: boolean) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ex = (b.x - a.x) / len;
    const ez = (b.z - a.z) / len;
    // stall lines lean 60° off the curb line, pointing into the lot
    const ang = (60 * Math.PI) / 180;
    const inx = -ez * inward;
    const inz = ex * inward;
    const dir = { x: ex * Math.cos(ang) + inx * Math.sin(ang), z: ez * Math.cos(ang) + inz * Math.sin(ang) };
    const step = 108 / Math.sin(ang);
    const depth = 216;
    let k = 0;
    for (let s = from; s <= to; s += step, k++) {
      const p = { x: a.x + ex * s + inx * 6, z: a.z + ez * s + inz * 6 };
      stripe(p, dir, depth, 4);
      if (ada && k === 1) {
        // accessible stall: blue hatched access aisle beside it and a blue
        // symbol square (with white border) at the head of the stall
        const aisle = step * 0.55;
        for (let h = 14; h < depth - 10; h += 24) {
          stripeTo(adaG, { x: p.x + dir.x * h, z: p.z + dir.z * h }, { x: ex, z: ez }, aisle, 3.5, LOT_Y + 0.4);
        }
        stripe({ x: p.x + ex * aisle, z: p.z + ez * aisle }, dir, depth, 4);
        const c = { x: p.x + ex * (aisle + step * 0.5) + dir.x * depth * 0.62, z: p.z + ez * (aisle + step * 0.5) + dir.z * depth * 0.62 };
        const sq = (half: number, out: Geo[], y: number) =>
          quad(out, [
            { x: c.x - ex * half - dir.x * half, z: c.z - ez * half - dir.z * half },
            { x: c.x + ex * half - dir.x * half, z: c.z + ez * half - dir.z * half },
            { x: c.x + ex * half + dir.x * half, z: c.z + ez * half + dir.z * half },
            { x: c.x - ex * half + dir.x * half, z: c.z - ez * half + dir.z * half },
          ], y);
        sq(24, stripeG, LOT_Y + 0.35);
        sq(21, adaG, LOT_Y + 0.45);
      }
    }
  };
  row(LOT_POLY[0], LOT_POLY[1], 1, 60, 780, true);
  row(LOT_POLY[3], LOT_POLY[2], -1, 60, 1180, false);
  const stripes = merged(stripeG, tag(new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.75, metalness: 0 }), 'generic', {}, 'lotStripes'));
  stripes.receiveShadow = true;
  const adaPaint = merged(adaG, tag(new THREE.MeshStandardMaterial({ color: 0x2a5aa6, roughness: 0.7, metalness: 0 }), 'generic', {}, 'lotAda'));
  adaPaint.receiveShadow = true;
  group.add(stripes, adaPaint);

  // tall lot light west of the lot (photos 01/03)
  {
    const px = -500;
    const pz = -1650;
    const py = terrainY(px, pz);
    const H = 240; // 20' pole: its head sits about at deck level (photos 03/04)
    const poleG: Geo[] = [];
    poleG.push(new THREE.CylinderGeometry(i2m(1.6), i2m(2.6), i2m(H), 10).translate(i2m(px), i2m(py + H / 2), i2m(pz)));
    poleG.push(new THREE.CylinderGeometry(i2m(6), i2m(7), i2m(18), 10).translate(i2m(px), i2m(py + 9), i2m(pz))); // footing
    poleG.push(box(px - 1, px + 30, py + H - 4, py + H - 1, pz - 1, pz + 1));
    poleG.push(box(px + 22, px + 42, py + H - 8, py + H - 2, pz - 6, pz + 6)); // shoebox head
    const pole = merged(poleG, tag(new THREE.MeshStandardMaterial({ color: 0x3d3f42, roughness: 0.55, metalness: 0.6 }), 'metal-dark', {}, 'lotPole'));
    pole.castShadow = true;
    group.add(pole);
  }

  // --- white/blue modular construction trailer on the lot's east end ------
  {
    const tx = 820;
    const tz = -1222;
    const L = 480;
    const D = 144;
    const base = LOT_Y;
    const skirtH = 22;
    const bodyH = 110;
    const siding = trailerSidingTexture();
    siding.repeat.set(L / 48, 1);
    const sidingMat = tag(new THREE.MeshStandardMaterial({ map: siding, roughness: 0.55, metalness: 0.1 }), 'paint-wall', {}, 'trailerSiding');
    const body = new THREE.Mesh(box(tx - L / 2, tx + L / 2, base + skirtH, base + skirtH + bodyH, tz - D / 2, tz + D / 2), sidingMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const blue = tag(new THREE.MeshStandardMaterial({ color: 0x2a5e9e, roughness: 0.5, metalness: 0.2 }), 'paint-trim', {}, 'trailerBlue');
    const trimG: Geo[] = [
      box(tx - L / 2 - 0.4, tx + L / 2 + 0.4, base + skirtH + bodyH - 8, base + skirtH + bodyH + 1, tz - D / 2 - 0.4, tz + D / 2 + 0.4),
      box(tx - L / 2 - 0.4, tx + L / 2 + 0.4, base + skirtH, base + skirtH + 5, tz - D / 2 - 0.4, tz + D / 2 + 0.4),
    ];
    // window frames + door on the face toward the deck (+z)
    const zf = tz + D / 2;
    for (const wx of [tx + 120, tx + 200]) trimG.push(box(wx - 20, wx + 20, base + skirtH + 40, base + skirtH + 84, zf, zf + 0.8));
    trimG.push(box(tx + L / 2 - 60, tx + L / 2 - 20, base + skirtH + 6, base + skirtH + 88, zf, zf + 0.8));
    const trims = merged(trimG, blue);
    trims.castShadow = true;
    group.add(trims);
    const dark = tag(new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.15, metalness: 0.3 }), 'glass-clear', { thin: true }, 'trailerGlass');
    const glassG: Geo[] = [];
    for (const wx of [tx + 120, tx + 200]) glassG.push(box(wx - 17, wx + 17, base + skirtH + 43, base + skirtH + 81, zf + 0.8, zf + 1));
    group.add(merged(glassG, dark));
    // yellow sign panel (no lettering) and the dark skirting
    const sign = new THREE.Mesh(
      box(tx - 150, tx - 40, base + skirtH + 50, base + skirtH + 80, zf, zf + 0.6),
      tag(new THREE.MeshStandardMaterial({ color: 0xe7c43a, roughness: 0.6, metalness: 0 }), 'paint-trim', {}, 'trailerSign'),
    );
    const skirt = new THREE.Mesh(
      box(tx - L / 2 + 6, tx + L / 2 - 6, base, base + skirtH, tz - D / 2 + 6, tz + D / 2 - 6),
      tag(new THREE.MeshStandardMaterial({ color: 0x4d5055, roughness: 0.8, metalness: 0.2 }), 'metal-dark', {}, 'trailerSkirt'),
    );
    const roof = new THREE.Mesh(
      box(tx - L / 2 - 2, tx + L / 2 + 2, base + skirtH + bodyH + 1, base + skirtH + bodyH + 3, tz - D / 2 - 2, tz + D / 2 + 2),
      tag(new THREE.MeshStandardMaterial({ color: 0xcfd2d0, roughness: 0.6, metalness: 0.3 }), 'metal-stainless', {}, 'trailerRoof'),
    );
    for (const m of [sign, skirt, roof]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    group.add(sign, skirt, roof);
    // bundled lumber on pallets by the trailer's west end (photo 01)
    const lumberG: Geo[] = [];
    const palletG: Geo[] = [];
    for (const [lx, lz, h] of [
      [tx - L / 2 - 70, tz + 30, 34],
      [tx - L / 2 - 70, tz - 30, 26],
      [tx - L / 2 - 130, tz + 20, 40],
    ] as const) {
      palletG.push(box(lx - 24, lx + 24, base, base + 5, lz - 22, lz + 22));
      lumberG.push(box(lx - 23, lx + 23, base + 5, base + 5 + h, lz - 20, lz + 20));
    }
    const lumber = merged(lumberG, tag(new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.85, metalness: 0 }), 'generic', {}, 'lumber'));
    const pallets = merged(palletG, tag(new THREE.MeshStandardMaterial({ color: 0x7d6a52, roughness: 0.9, metalness: 0 }), 'generic', {}, 'pallets'));
    for (const m of [lumber, pallets]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    group.add(lumber, pallets);
  }

  // --- slope planting between the deck and the lot: lavender drifts,
  //     evergreen shrubs (cross-card clumps) --------------------------------
  const plantCards = (kind: 'lavender' | 'shrub', n: number, size: [number, number], height: [number, number], seed: number) => {
    const r2 = mulberry32(seed);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    let placed = 0;
    let guard = 0;
    // drifts: clusters around random centres
    while (placed < n && guard++ < n * 40) {
      const ccx = -320 + r2() * 1250;
      const ccz = -1100 + r2() * 640;
      const inDrift = 3 + ((r2() * 8) | 0);
      for (let k = 0; k < inDrift && placed < n; k++) {
        const x = ccx + (r2() - 0.5) * 140;
        const z = ccz + (r2() - 0.5) * 90;
        const p = { x, z };
        const dD = sdPoly(p, DECK_POLY);
        if (dD < 20 || dD > 640 || sdPoly(p, LOT_POLY) < 30) continue;
        if (z > -380 && x > -150 && x < 720) continue; // not under the deck
        const y = terrainY(x, z);
        const w = size[0] + r2() * (size[1] - size[0]);
        const h = height[0] + r2() * (height[1] - height[0]);
        const yaw0 = r2() * Math.PI;
        const tint = 0.85 + r2() * 0.25;
        for (let q = 0; q < 3; q++) {
          const a = yaw0 + (q * Math.PI) / 3;
          const dx = Math.cos(a) * w * 0.5;
          const dz = Math.sin(a) * w * 0.5;
          const base = pos.length / 3;
          const cell = (r2() * 4) | 0;
          const u0 = (cell % 2) * 0.5;
          const v0 = cell < 2 ? 0.5 : 0;
          for (const [s, t] of [
            [-1, 0],
            [1, 0],
            [1, 1],
            [-1, 1],
          ]) {
            pos.push(i2m(x + dx * s), i2m(y - 3 + h * t), i2m(z + dz * s));
            // soft dome normals so clumps shade as mounds
            const nx = s * Math.cos(a) * 0.5;
            const nz = s * Math.sin(a) * 0.5;
            const l = Math.hypot(nx, 0.8, nz);
            nor.push(nx / l, 0.8 / l, nz / l);
            uv.push(u0 + ((s + 1) / 2) * 0.49 + 0.005, v0 + t * 0.49 + 0.005);
            const ao = 0.7 + 0.3 * t;
            col.push(tint * ao, tint * ao, tint * ao);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        placed++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, sharedLeafMat(kind));
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = `slope-${kind}`;
    group.add(m);
  };
  plantCards('lavender', 200, [26, 40], [22, 34], 0x1a7e);
  plantCards('shrub', 150, [40, 70], [34, 62], 0x5b5b);

  // --- trees ---------------------------------------------------------------
  const at = (x: number, z: number) => terrainY(x, z);
  const oaks = new TreeBatch({ ...COAST_LIVE_OAK, name: 'siteOak' });
  const oakSpots: [number, number, number, number, number, number?, number?][] = [
    // x, z, height, spread, seed, leanDeg, leanAz(true-ish model az)
    [-380, -700, 440, 290, 31],
    [-470, -300, 420, 260, 32],
    [-560, -1040, 470, 320, 33],
    [860, -440, 470, 280, 34, 14, 240],
    [990, -130, 420, 260, 35],
    [-470, 110, 380, 230, 36],
  ];
  for (const [x, z, h, s, seed, lean, laz] of oakSpots) {
    oaks.add({ ...autoTree(COAST_LIVE_OAK, { x, z, y: at(x, z), height: h, spread: s, seed, leanDeg: lean, leanAzDeg: laz }), density: 0.62 }, seed);
  }
  group.add(batchMeshes(oaks, { bark: oakBarkMat, leaves: sharedLeafMat('oak') }));

  const pineBark = barkMaterial('pine', 'pineBark');
  const pines = new TreeBatch(STONE_PINE);
  for (const [x, z, h, s, seed] of [
    [1250, -1300, 640, 300, 41],
    [1270, -620, 600, 280, 42],
    [-820, -760, 620, 290, 43],
  ] as const) {
    pines.add(autoTree(STONE_PINE, { x, z, y: at(x, z), height: h, spread: s, seed }), seed);
  }
  group.add(batchMeshes(pines, { bark: pineBark, leaves: sharedLeafMat('pine') }));

  const eucs = new TreeBatch(EUCALYPTUS);
  for (const [x, z, h, s, seed] of [
    [360, -690, 390, 190, 51],
    [1180, -300, 760, 210, 52],
  ] as const) {
    eucs.add(autoTree(EUCALYPTUS, { x, z, y: at(x, z), height: h, spread: s, seed, leanDeg: 6 }), seed);
  }
  group.add(batchMeshes(eucs, { bark: barkMaterial('eucalyptus', 'eucalyptusBark'), leaves: sharedLeafMat('eucalyptus') }));

  const olives = new TreeBatch(OLIVE);
  for (const [x, z, h, s, seed] of [
    [640, -660, 260, 150, 61],
    [-210, -800, 240, 140, 62],
  ] as const) {
    olives.add(autoTree(OLIVE, { x, z, y: at(x, z), height: h, spread: s, seed }), seed);
  }
  group.add(batchMeshes(olives, { bark: barkMaterial('olive', 'oliveBark'), leaves: sharedLeafMat('olive') }));

  const crapes = new TreeBatch(CRAPE_MYRTLE);
  for (const [x, z, h, s, seed] of [
    [60, -720, 200, 100, 71],
    [-130, -690, 180, 90, 72],
    [470, -640, 190, 95, 73],
  ] as const) {
    crapes.add(autoTree(CRAPE_MYRTLE, { x, z, y: at(x, z), height: h, spread: s, seed }), seed);
  }
  group.add(batchMeshes(crapes, { bark: barkMaterial('crape', 'crapeBark'), leaves: sharedLeafMat('crape') }));

  // --- mid-distance woodland: cheap variants on the falling ground --------
  const farOak = farVariant(COAST_LIVE_OAK);
  const farPine = farVariant(STONE_PINE);
  const woods = new TreeBatch(farOak);
  const woodsPine = new TreeBatch(farPine);
  let placed = 0;
  let guard = 0;
  while (placed < 46 && guard++ < 4000) {
    const a = rnd() * Math.PI * 2;
    const r = (1100 + rnd() * 1300) * (1 + 0.3 * rnd());
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const p = { x, z };
    if (sdRect(x, z, -2150, 3450, 250, 2750) < 60) continue; // campus
    if (sdPoly(p, LOT_POLY) < 200 || sdPoly(p, DECK_POLY) < 500) continue;
    if (sdRect(x, z, -650, 750, -40, 730) < 200) continue;
    const seed = 100 + placed;
    const pine = rnd() < 0.07;
    const spec = autoTree(pine ? STONE_PINE : COAST_LIVE_OAK, {
      x,
      z,
      y: at(x, z),
      height: pine ? 560 + rnd() * 120 : 380 + rnd() * 160,
      spread: pine ? 260 : 240 + rnd() * 120,
      seed,
    });
    (pine ? woodsPine : woods).add({ ...spec, density: 0.9 }, seed);
    placed++;
  }
  const woodsMeshes = batchMeshes(woods, { bark: oakBarkMat, leaves: sharedLeafMat('oak') }, false);
  const woodsPineMeshes = batchMeshes(woodsPine, { bark: pineBark, leaves: sharedLeafMat('pine') }, false);
  group.add(woodsMeshes, woodsPineMeshes);
}
