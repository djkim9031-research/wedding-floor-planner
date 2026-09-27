import * as THREE from 'three';
import { BAY_X, RIDGE_X, i2m } from '../../constants';
import { registerFixtures, type FixtureDef } from '../fixtures';
import { RAFTER_D, box, merged, rod, roofY, type Geo, type P3 } from './geom';
import { GLULAM_BOT } from './hallShell';
import { RAFTER_Z } from './hallRoof';
import type { HallMaterials } from './materials';

// Hall fixtures from photos 02/05: white track under each glulam with pairs
// of LED spot heads on short cross-bars (photometry registered for the path
// tracer / Blender), the ceiling projector on its scissor lift, the drop-down
// screen in front of the window wall's centre bay, speakers, the rafter strip
// lights and the entry EXIT sign.

/** Track-head pairs along each glulam (z, inches) — every 8', clear of the posts. */
export const TRACK_PAIR_Z = [54, 150, 246, 354, 450, 546];
const HEAD_R = 1.4;
const HEAD_LEN = 4.5;
const ARM = 7.5; // head offset either side of the beam centreline

export interface TrackHead {
  id: string;
  pivot: P3;
  lens: P3;
  aim: P3;
}

/** Layout of every track head: position, lens centre and aim point (inches). */
export function trackHeads(): TrackHead[] {
  const out: TrackHead[] = [];
  const barY = GLULAM_BOT - 2.1;
  BAY_X.slice(1, 3).forEach((bx, bi) => {
    const side = bi === 0 ? 'W' : 'E';
    TRACK_PAIR_Z.forEach((z, k) => {
      for (const s of [-1, 1]) {
        const hx = bx + s * ARM;
        const inward = (hx - bx) * (RIDGE_X - bx) > 0; // head on the room-centre side
        // heads splay across and along the room (photos: lenses face both ways)
        const along = ((k + bi + (s > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1) * (60 + ((k * 37 + bi * 23) % 41));
        const aim = { x: inward ? bx + Math.sign(RIDGE_X - bx) * 70 : bx - Math.sign(RIDGE_X - bx) * 85, y: 30, z: z + along };
        const pivot = { x: hx, y: barY - 2, z };
        const d = new THREE.Vector3(aim.x - pivot.x, aim.y - pivot.y, aim.z - pivot.z).normalize();
        const lens = { x: pivot.x + d.x * (HEAD_LEN - 0.5), y: pivot.y + d.y * (HEAD_LEN - 0.5), z: pivot.z + d.z * (HEAD_LEN - 0.5) };
        out.push({ id: `hall-track-${side}${k + 1}${s < 0 ? 'a' : 'b'}`, pivot, lens, aim });
      }
    });
  });
  return out;
}

/** Track rails + heads: stay with the beams in the venue group. */
export function buildTrackLights(m: HallMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hallTrackLights';
  const whiteG: Geo[] = [];
  const lensG: Geo[] = [];
  const barY = GLULAM_BOT - 2.1;
  for (const bx of [BAY_X[1], BAY_X[2]]) {
    whiteG.push(box(bx - 0.7, bx + 0.7, GLULAM_BOT - 1.1, GLULAM_BOT, 8, 591)); // track
    for (const z of TRACK_PAIR_Z) whiteG.push(box(bx - ARM - 0.5, bx + ARM + 0.5, barY, barY + 1, z - 0.5, z + 0.5)); // cross-bar
  }
  const up = new THREE.Vector3(0, 1, 0);
  const heads = trackHeads();
  for (const h of heads) {
    whiteG.push(rod({ x: h.pivot.x, y: barY, z: h.pivot.z }, h.pivot, 0.35, 6)); // stem
    const d = new THREE.Vector3(h.aim.x - h.pivot.x, h.aim.y - h.pivot.y, h.aim.z - h.pivot.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d);
    const body = new THREE.CylinderGeometry(i2m(HEAD_R), i2m(HEAD_R * 0.9), i2m(HEAD_LEN), 12, 1);
    body.applyQuaternion(q);
    const c = new THREE.Vector3(h.pivot.x, h.pivot.y, h.pivot.z).addScaledVector(d, HEAD_LEN / 2 - 0.75);
    body.translate(i2m(c.x), i2m(c.y), i2m(c.z));
    whiteG.push(body);
    const lens = new THREE.CircleGeometry(i2m(HEAD_R * 0.8), 12);
    lens.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d));
    const lc = new THREE.Vector3(h.pivot.x, h.pivot.y, h.pivot.z).addScaledVector(d, HEAD_LEN - 0.75 + 0.02);
    lens.translate(i2m(lc.x), i2m(lc.y), i2m(lc.z));
    lensG.push(lens);
  }
  const housings = merged(whiteG, m.fixtureWhite);
  housings.castShadow = false;
  const lenses = merged(lensG, m.lens);
  lenses.castShadow = false;
  g.add(housings, lenses);

  registerFixtures(
    heads.map<FixtureDef>((h) => ({
      id: h.id,
      kind: 'spot',
      group: 'interior',
      posIn: [h.lens.x, h.lens.y, h.lens.z],
      aimIn: [h.aim.x, h.aim.y, h.aim.z],
      cct: 3000,
      intensityCd: 2000,
      beamDeg: 36,
      radiusIn: 0.8,
      lensMaterial: m.lens.name,
    })),
  );
  return g;
}

/** EXIT sign on the entry portal's header (hall side). */
export function buildExitSign(m: HallMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'exitSign';
  const body = new THREE.Mesh(box(266, 279, 108.5, 116.5, 595.2, 597), m.metalDark);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(i2m(12.2), i2m(7.4)), m.exitFace);
  face.rotation.y = Math.PI;
  face.position.set(i2m(272.5), i2m(112.5), i2m(595.1));
  g.add(body, face);
  return g;
}

/** Ceiling-hung props (roof group): projector lift, screen, speakers, strips. */
export function buildCeilingProps(m: HallMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hallCeilingProps';
  const whiteG: Geo[] = [];
  const blackG: Geo[] = [];
  const liftG: Geo[] = [];

  // --- projector on a scissor lift under the ridge (photo 05). Throw ≈ 17'
  // to the screen; the lift hangs from the rafter at z ≈ 217.
  const PZ = 210;
  const PX = RIDGE_X;
  const hoodTop = roofY(PX) - 12;
  whiteG.push(box(PX - 10, PX + 10, hoodTop - 16, hoodTop, PZ - 10, PZ + 10)); // lift housing
  whiteG.push(box(PX - 1.5, PX + 1.5, hoodTop, roofY(PX) - 1, PZ + 5, PZ + 8)); // hanger
  const liftTop = hoodTop - 16;
  const liftBot = 121;
  const segs = 5;
  const sh = (liftTop - liftBot) / segs;
  for (const sx of [-5, 5]) {
    for (let i = 0; i < segs; i++) {
      const y0 = liftTop - i * sh;
      const y1 = y0 - sh;
      liftG.push(rod({ x: PX + sx, y: y0, z: PZ - 5 }, { x: PX + sx, y: y1, z: PZ + 5 }, 0.45, 5));
      liftG.push(rod({ x: PX + sx, y: y0, z: PZ + 5 }, { x: PX + sx, y: y1, z: PZ - 5 }, 0.45, 5));
    }
  }
  whiteG.push(box(PX - 9, PX + 9, liftBot - 1.5, liftBot, PZ - 9, PZ + 9)); // mount plate
  blackG.push(box(PX - 8.5, PX + 8.5, liftBot - 8.5, liftBot - 1.5, PZ - 8, PZ + 8)); // projector
  blackG.push(rod({ x: PX + 4, y: liftBot - 5, z: PZ - 8 }, { x: PX + 4, y: liftBot - 5, z: PZ - 10 }, 1.6, 12)); // lens barrel
  whiteG.push(box(PX - 12, PX + 12, liftBot - 11, liftBot - 10, PZ - 12, PZ + 12)); // closure panel below
  for (const [dx, dz] of [
    [-10, -10],
    [10, -10],
    [-10, 10],
    [10, 10],
  ]) {
    liftG.push(rod({ x: PX + dx, y: liftBot - 10, z: PZ + dz }, { x: PX + dx, y: liftBot - 1.5, z: PZ + dz }, 0.2, 4));
  }

  // --- drop-down screen in front of the window wall's centre bay
  const SX0 = 211;
  const SX1 = 334;
  const SZ = 9.4;
  blackG.push(box(SX0 - 5, SX1 + 5, 127, 132, SZ - 2.5, SZ + 2.5)); // case
  for (const hx of [SX0 + 6, SX1 - 6]) blackG.push(box(hx - 0.4, hx + 0.4, 132, roofY(hx) - RAFTER_D, SZ - 0.4, SZ + 0.4));
  const screenBlackG: Geo[] = [
    box(SX0, SX1, 117, 127, SZ - 0.1, SZ + 0.1), // black drop
    box(SX0 - 1.5, SX0, 49, 127, SZ - 0.1, SZ + 0.1),
    box(SX1, SX1 + 1.5, 49, 127, SZ - 0.1, SZ + 0.1),
    box(SX0, SX1, 49, 50.5, SZ - 0.1, SZ + 0.1),
  ];
  blackG.push(box(SX0 - 2, SX1 + 2, 47.5, 49, SZ - 0.5, SZ + 0.5)); // bottom bar
  const screen = new THREE.Mesh(box(SX0, SX1, 50.5, 117, SZ - 0.1, SZ + 0.1), m.screen);
  screen.name = 'projectionScreen';
  g.add(screen, merged(screenBlackG, m.screenBlack));

  // --- speakers: wall-mounted high on the west wall (photo 05) and one
  // pendant under the ridge near the south end (photo 02)
  blackG.push(box(0.5, 11, 124, 140, 92, 104));
  blackG.push(box(544 - 10.5, 544.5, 124, 140, 300, 312));
  const spk = new THREE.CylinderGeometry(i2m(4.5), i2m(4.5), i2m(9), 14, 1);
  spk.translate(i2m(RIDGE_X), i2m(roofY(RIDGE_X) - 16), i2m(588));
  blackG.push(spk);
  liftG.push(rod({ x: RIDGE_X, y: roofY(RIDGE_X) - 11.5, z: 588 }, { x: RIDGE_X, y: roofY(RIDGE_X) - 6, z: 588 }, 0.4, 5));

  // --- linear strip fixtures clipped under rafters, mid-slope (photo 05)
  RAFTER_Z.forEach((rz, k) => {
    if (k % 2 !== 1 || rz > 560) return;
    for (const [x0, x1] of [
      [40, 88],
      [457, 505],
    ]) {
      const off = RAFTER_D + 1.2;
      whiteG.push(rod({ x: x0, y: roofY(x0) - off, z: rz }, { x: x1, y: roofY(x1) - off, z: rz }, 0.9, 8));
    }
  });

  g.add(merged(whiteG, m.fixtureWhite), merged(blackG, m.metalDark), merged(liftG, m.fixtureWhite));
  return g;
}
