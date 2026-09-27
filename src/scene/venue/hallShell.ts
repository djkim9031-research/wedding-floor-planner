import * as THREE from 'three';
import { BAY_X, COLUMNS, DOOR_HEAD_Y, STOREFRONT_HEAD_Y, i2m } from '../../constants';
import { GLULAM_D, GLULAM_W, RAFTER_D, box, gablePrism, merged, roofY, worldUV, type Geo } from './geom';
import type { HallMaterials } from './materials';

// The hall's walls, glazing, posts and beams (reference photos 02/05), plus
// the covered deck bay's posts and pier (photo 03). Everything here stays
// visible with the roof hidden; the ceiling lives in hallRoof.ts.

/** Window-wall (north) lites run floor → header; rail across them at ~34". */
export const NORTH_HEAD_Y = 120;
export const NORTH_HEADER_TOP = 132;
export const RAIL_Y = 34;
/** South frosted-panel wall: rail at ~36", head at 96", header band to 108. */
export const SOUTH_RAIL_Y = 36;
export const SOUTH_HEADER_TOP = 108;
/** Entry alcove (the plan's vestibule bulge) ceiling. */
export const ALCOVE_CEIL_Y = 96;

export const GLULAM_TOP = roofY(BAY_X[1]) - RAFTER_D;
export const GLULAM_BOT = GLULAM_TOP - GLULAM_D;
/** Posts are split here: below stays with the walls, above rides the roof group. */
const POST_SPLIT = 108;

interface Buckets {
  paint: Geo[];
  stucco: Geo[];
  trim: Geo[];
  base: Geo[];
  glass: Geo[];
  frosted: Geo[];
  sage: Geo[];
  metalDark: Geo[];
  stainless: Geo[];
}

type Out = '-x' | '+x' | '-z' | '+z';

/** Solid wall: 1" white paint skin on the hall face at `plane`, 5" stucco
 * behind it (toward `out`). a0..a1 run along the wall, y0..y1 heights. */
function wall(b: Buckets, out: Out, plane: number, a0: number, a1: number, y0: number, y1: number): void {
  const s = out[0] === '-' ? -1 : 1;
  const p0 = plane;
  const p1 = plane + s;
  const p2 = plane + 6 * s;
  const mk = (n0: number, n1: number) =>
    out[1] === 'x'
      ? box(Math.min(n0, n1), Math.max(n0, n1), y0, y1, a0, a1)
      : box(a0, a1, y0, y1, Math.min(n0, n1), Math.max(n0, n1));
  b.paint.push(mk(p0, p1));
  b.stucco.push(mk(p1, p2));
}

/** Framed lite: 1.5" frames (adjacent lites' frames meet as 3" mullions).
 * axis 'x' = wall runs along x at z = n; 'z' = along z at x = n. */
function lite(b: Buckets, bucket: Geo[], axis: 'x' | 'z', n: number, a0: number, a1: number, y0: number, y1: number, fw = 1.5, fd = 4): void {
  const rail = (ry0: number, ry1: number, c0: number, c1: number) =>
    axis === 'x' ? box(c0, c1, ry0, ry1, n - fd / 2, n + fd / 2) : box(n - fd / 2, n + fd / 2, ry0, ry1, c0, c1);
  b.trim.push(rail(y0, y0 + fw, a0, a1));
  b.trim.push(rail(y1 - fw, y1, a0, a1));
  b.trim.push(rail(y0 + fw, y1 - fw, a0, a0 + fw));
  b.trim.push(rail(y0 + fw, y1 - fw, a1 - fw, a1));
  bucket.push(
    axis === 'x'
      ? box(a0 + fw, a1 - fw, y0 + fw, y1 - fw, n - 0.3, n + 0.3)
      : box(n - 0.3, n + 0.3, y0 + fw, y1 - fw, a0 + fw, a1 - fw),
  );
}

/** Lite split by a horizontal rail at railY (two stacked framed lites). */
function railedLite(b: Buckets, bucket: Geo[], axis: 'x' | 'z', n: number, a0: number, a1: number, y0: number, y1: number, railY: number, fw = 1.5): void {
  lite(b, bucket, axis, n, a0, a1, y0, railY, fw);
  lite(b, bucket, axis, n, a0, a1, railY, y1, fw);
}

/** Hall shell (walls, glazing, posts: always shown) and the glulam beams
 * (ride the roof group so the editor's bird's-eye view stays clear). */
export function buildHallShell(m: HallMaterials): { shell: THREE.Group; beams: THREE.Group } {
  const g = new THREE.Group();
  g.name = 'hallShell';
  const beams = new THREE.Group();
  beams.name = 'hallGlulams';
  const beamWhite: Geo[] = [];
  const beamSage: Geo[] = [];
  const b: Buckets = { paint: [], stucco: [], trim: [], base: [], glass: [], frosted: [], sage: [], metalDark: [], stainless: [] };
  const topEW = roofY(0) + 1; // east/west wall tops tuck between reed and roof deck

  // -------------------------------------------------------------------------
  // North window wall z = 0 (photo 05): white posts, floor→10' lites with a
  // rail at 34", header band, clerestory above (hallRoof). Slider bay in the
  // middle opens onto the deck.
  // -------------------------------------------------------------------------
  const postXs = [0, 91, 183, 363, 452, 545];
  for (const x of postXs) {
    const x0 = x === 0 ? -6 : x - 3.5;
    const x1 = x === 545 ? 551 : x + 3.5;
    b.trim.push(box(x0, x1, 0, NORTH_HEADER_TOP, -6, 0));
    if (x === 183 || x === 363) beamWhite.push(box(x0, x1, NORTH_HEADER_TOP, GLULAM_BOT, -6, 0)); // on up to the beam
  }
  b.trim.push(box(-6, 551, NORTH_HEAD_Y, NORTH_HEADER_TOP, -6, 0)); // header band
  for (const [a, c] of [
    [4, 87.5],
    [94.5, 179.5],
    [366.5, 448.5],
    [455.5, 541],
  ]) {
    const mid = (a + c) / 2;
    railedLite(b, b.glass, 'x', -3, a, mid, 0, NORTH_HEAD_Y, RAIL_Y);
    railedLite(b, b.glass, 'x', -3, mid, c, 0, NORTH_HEAD_Y, RAIL_Y);
  }
  // slider bay 186.5–359.5: four panels, the middle two slid aside (open)
  const sliderPanel = (x0: number, x1: number, zc: number) => {
    const fw = 2.5;
    b.trim.push(box(x0, x1, 0, fw, zc - 1, zc + 1));
    b.trim.push(box(x0, x1, 96 - fw, 96, zc - 1, zc + 1));
    b.trim.push(box(x0, x0 + fw, fw, 96 - fw, zc - 1, zc + 1));
    b.trim.push(box(x1 - fw, x1, fw, 96 - fw, zc - 1, zc + 1));
    b.trim.push(box(x0 + fw, x1 - fw, RAIL_Y - 1.25, RAIL_Y + 1.25, zc - 1, zc + 1));
    b.glass.push(box(x0 + fw, x1 - fw, fw, 96 - fw, zc - 0.3, zc + 0.3));
  };
  sliderPanel(186.5, 230, -4.2); // closed
  sliderPanel(186.5, 230, -1.7); // open, slid west
  sliderPanel(316, 359.5, -1.7); // open, slid east
  sliderPanel(316, 359.5, -4.2); // closed
  b.trim.push(box(186.5, 359.5, 0, 0.75, -5.5, -0.5)); // floor track
  for (const [a, c] of [
    [186.5, 230],
    [230, 273],
    [273, 316],
    [316, 359.5],
  ]) {
    lite(b, b.glass, 'x', -3, a, c, 96, NORTH_HEAD_Y); // transoms over the sliders
  }

  // -------------------------------------------------------------------------
  // West wall x = 0: two tall lites with roller shades down (photo 05, far
  // left), a closed service door, the rest solid.
  // -------------------------------------------------------------------------
  const westLite = (z0: number, z1: number) => {
    const mid = (z0 + z1) / 2;
    railedLite(b, b.frosted, 'z', -3, z0, mid, 0, NORTH_HEAD_Y, RAIL_Y);
    railedLite(b, b.frosted, 'z', -3, mid, z1, 0, NORTH_HEAD_Y, RAIL_Y);
    wall(b, '-x', 0, z0, z1, NORTH_HEAD_Y, topEW);
  };
  wall(b, '-x', 0, 0, 4, 0, topEW);
  westLite(4, 42);
  wall(b, '-x', 0, 42, 52, 0, topEW);
  westLite(52, 92);
  wall(b, '-x', 0, 92, 129, 0, topEW);
  wall(b, '-x', 0, 129, 165, DOOR_HEAD_Y, topEW); // over the closed door
  b.trim.push(box(-5, -1, 0, DOOR_HEAD_Y, 129, 130.5));
  b.trim.push(box(-5, -1, 0, DOOR_HEAD_Y, 163.5, 165));
  b.trim.push(box(-5, -1, 82.5, DOOR_HEAD_Y, 130.5, 163.5));
  b.trim.push(box(-3.9, -2.1, 0, 82.5, 130.5, 163.5)); // leaf
  wall(b, '-x', 0, 165, 419, 0, topEW);

  // -------------------------------------------------------------------------
  // East wall x = 545: storefront + glass door near the deck, then solid.
  // -------------------------------------------------------------------------
  railedLite(b, b.glass, 'z', 548, 2, 40, 0, NORTH_HEAD_Y, RAIL_Y);
  railedLite(b, b.glass, 'z', 548, 40, 78, 0, NORTH_HEAD_Y, RAIL_Y);
  lite(b, b.glass, 'z', 548, 78, 114, 0, DOOR_HEAD_Y, 2.5); // closed glass door
  lite(b, b.glass, 'z', 548, 78, 114, DOOR_HEAD_Y, NORTH_HEAD_Y);
  wall(b, '+x', 545, 0, 2, 0, topEW);
  wall(b, '+x', 545, 2, 114, NORTH_HEAD_Y, topEW);
  wall(b, '+x', 545, 114, 419, 0, topEW);

  // -------------------------------------------------------------------------
  // Notches (the room narrows to x 65–484 south of z 419): E-W walls whose
  // tops follow the roof, and the N-S legs down to the south wall.
  // -------------------------------------------------------------------------
  b.paint.push(gablePrism(0, 65, 419, 420, 0, -1));
  b.stucco.push(gablePrism(-6, 0, 419, 420, 0, -1), gablePrism(-6, 65, 420, 425, 0, -1));
  b.paint.push(gablePrism(484, 545, 419, 420, 0, -1));
  b.stucco.push(gablePrism(545, 551, 419, 420, 0, -1), gablePrism(484, 551, 420, 425, 0, -1));
  b.paint.push(box(64, 65, 0, roofY(65) + 1, 420, 599));
  b.stucco.push(box(59, 64, 0, roofY(65) + 1, 425, 605));
  b.paint.push(box(484, 485, 0, roofY(484) + 1, 420, 599));
  b.stucco.push(box(485, 490, 0, roofY(484) + 1, 425, 605));

  // -------------------------------------------------------------------------
  // South wall z = 599 (photo 02): white-framed roller-shade panels with a
  // rail at 36" and head at 96", header band to 108", clear clerestory above
  // (hallRoof). The entry is a portal into the plan's vestibule bulge, whose
  // back face carries the frameless glass doors — one plane of glazing.
  // -------------------------------------------------------------------------
  for (const [a, c] of [
    [65, 122.5],
    [122.5, 180],
    [371, 427.5],
    [427.5, 484],
  ]) {
    railedLite(b, b.frosted, 'x', 602, a, c, 0, STOREFRONT_HEAD_Y, SOUTH_RAIL_Y, 2);
  }
  b.trim.push(box(65, 180, STOREFRONT_HEAD_Y, SOUTH_HEADER_TOP, 599, 605));
  b.trim.push(box(371, 484, STOREFRONT_HEAD_Y, SOUTH_HEADER_TOP, 599, 605));
  // portal: posts + header proud of the wall by 2"
  b.trim.push(box(180, 186, 0, ALCOVE_CEIL_Y, 597, 605));
  b.trim.push(box(365, 371, 0, ALCOVE_CEIL_Y, 597, 605));
  b.trim.push(box(180, 371, ALCOVE_CEIL_Y, SOUTH_HEADER_TOP, 597, 605));
  // posts under the glulam ends, through the clerestory
  for (const bx of [BAY_X[1], BAY_X[2]]) beamWhite.push(box(bx - 2.5, bx + 2.5, SOUTH_HEADER_TOP, GLULAM_BOT, 599, 605));

  // alcove (x 180–371, z 605–659): white cheeks, flat white ceiling
  b.paint.push(box(179, 180, 0, ALCOVE_CEIL_Y, 605, 659));
  b.stucco.push(box(174, 179, 0, ALCOVE_CEIL_Y + 6, 599, 665));
  b.paint.push(box(371, 372, 0, ALCOVE_CEIL_Y, 605, 659));
  b.stucco.push(box(372, 377, 0, ALCOVE_CEIL_Y + 6, 599, 665));
  b.paint.push(box(180, 371, ALCOVE_CEIL_Y, ALCOVE_CEIL_Y + 1, 605, 659));
  b.stucco.push(box(174, 377, ALCOVE_CEIL_Y + 1, ALCOVE_CEIL_Y + 6, 599, 665));

  // door module on the alcove's back face (z 659–665)
  const DOOR_TOP = 92;
  b.trim.push(box(180, 184, 0, ALCOVE_CEIL_Y, 659, 665));
  b.trim.push(box(367, 371, 0, ALCOVE_CEIL_Y, 659, 665));
  b.trim.push(box(232, 236, 0, ALCOVE_CEIL_Y, 659, 665));
  b.trim.push(box(308, 312, 0, ALCOVE_CEIL_Y, 659, 665));
  b.trim.push(box(180, 371, DOOR_TOP, ALCOVE_CEIL_Y, 659, 665));
  railedLite(b, b.frosted, 'x', 662, 184, 232, 0, DOOR_TOP, SOUTH_RAIL_Y, 2);
  railedLite(b, b.frosted, 'x', 662, 312, 367, 0, DOOR_TOP, SOUTH_RAIL_Y, 2);
  // frameless tempered leaves with patch fittings and ladder pulls
  for (const [x0, x1, hinge] of [
    [236.5, 272.1, 236.5],
    [272.9, 308, 308],
  ]) {
    b.glass.push(box(x0, x1, 0.75, DOOR_TOP - 0.25, 661.75, 662.25));
    const hx0 = hinge === 236.5 ? hinge : hinge - 7;
    b.metalDark.push(box(hx0, hx0 + 7, 0.75, 3.75, 661.2, 662.8));
    b.metalDark.push(box(hx0, hx0 + 7, DOOR_TOP - 3.25, DOOR_TOP - 0.25, 661.2, 662.8));
  }
  for (const px of [268.5, 276.5]) {
    for (const pz of [659.6, 664.4]) {
      b.stainless.push(box(px - 0.5, px + 0.5, 30, 70, pz - 0.5, pz + 0.5));
      b.stainless.push(box(px - 0.4, px + 0.4, 31, 32, Math.min(pz, 662), Math.max(pz, 662)));
      b.stainless.push(box(px - 0.4, px + 0.4, 68, 69, Math.min(pz, 662), Math.max(pz, 662)));
    }
  }

  // -------------------------------------------------------------------------
  // Baseboards (interior faces of solid walls).
  // -------------------------------------------------------------------------
  const bb = 0.75;
  for (const [z0, z1] of [
    [0, 4],
    [42, 52],
    [92, 129],
    [165, 419],
  ]) {
    b.base.push(box(0, bb, 0, 4, z0, z1));
  }
  b.base.push(box(545 - bb, 545, 0, 4, 114, 419));
  b.base.push(box(0, 65, 0, 4, 419 - bb, 419));
  b.base.push(box(484, 545, 0, 4, 419 - bb, 419));
  b.base.push(box(65, 65 + bb, 0, 4, 419, 599));
  b.base.push(box(484 - bb, 484, 0, 4, 419, 599));
  b.base.push(box(180, 180 + bb, 0, 4, 605, 659));
  b.base.push(box(371 - bb, 371, 0, 4, 605, 659));

  // -------------------------------------------------------------------------
  // Posts + glulams: slim 6" posts (COLUMNS) up to 13'8" beams that sit right
  // under the rafters; the beams run out through the window wall and end
  // past the covered bay's fascia, painted sage outside (photo 03).
  // -------------------------------------------------------------------------
  // posts split at POST_SPLIT: the upper run rides with the beams (roof
  // group), so the editor shows the obstacles without 14' poles
  for (const c of COLUMNS) {
    const h = c.size / 2;
    b.trim.push(box(c.cx - h, c.cx + h, 0, POST_SPLIT, c.cz - h, c.cz + h));
    beamWhite.push(box(c.cx - h, c.cx + h, POST_SPLIT, GLULAM_BOT, c.cz - h, c.cz + h));
    b.trim.push(box(c.cx - h - 0.75, c.cx + h + 0.75, 0, 5, c.cz - h - 0.75, c.cz + h + 0.75)); // base block
  }
  const gw = GLULAM_W / 2;
  for (const bx of [BAY_X[1], BAY_X[2]]) {
    beamWhite.push(box(bx - gw, bx + gw, GLULAM_BOT, GLULAM_TOP, -6, 605));
    beamSage.push(box(bx - gw, bx + gw, GLULAM_BOT, GLULAM_TOP, -86, -6));
    // covered-bay post under the beam
    b.sage.push(box(bx - 2.75, bx + 2.75, 0, POST_SPLIT, -62.75, -57.25));
    beamSage.push(box(bx - 2.75, bx + 2.75, POST_SPLIT, GLULAM_BOT, -62.75, -57.25));
  }

  const add = (geos: Geo[], mat: THREE.Material, cast = true, receive = true) => {
    if (!geos.length) return null;
    const mesh = merged(geos, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    g.add(mesh);
    return mesh;
  };
  add(b.paint, m.paint);
  add(b.stucco, m.stucco);
  add(b.trim, m.trim);
  add(b.base, m.baseboard, false, true);
  add(b.glass, m.glass, false, false);
  add(b.frosted, m.frosted, true, false);
  add(b.sage, m.sage);
  add(b.metalDark, m.metalDark, false, true);
  add(b.stainless, m.stainless, false, true);

  // rough stucco pier at the covered bay's NW corner (photos 03 + 05)
  const pierTop = roofY(4) - RAFTER_D;
  const pier = new THREE.Mesh(worldUV(box(-10, 18, 0, pierTop, -74, -46), 48), m.pier);
  pier.castShadow = true;
  pier.receiveShadow = true;
  g.add(pier);

  // etched roundel across the doors' meeting stiles
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(i2m(28), i2m(28)), m.logo);
  logo.rotation.y = Math.PI; // faces the hall
  logo.position.set(i2m(272.5), i2m(66), i2m(661.6));
  logo.renderOrder = 2;
  g.add(logo);

  beams.add(merged(beamWhite, m.trim), merged(beamSage, m.sage));
  return { shell: g, beams };
}
