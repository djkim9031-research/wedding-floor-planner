import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  i2m,
  ROOM_POLYGON,
  COLUMNS,
  BAY_X,
  EAVE_Y,
  RIDGE_Y,
  RIDGE_X,
  WINDOW_SILL_Y,
  DOOR_HEAD_Y,
  STOREFRONT_HEAD_Y,
} from '../constants';
import { floorWoodTextures, reedTexture } from './textures';

type Geo = THREE.BufferGeometry;

const WALL_T = 6;
const SLOPE = (RIDGE_Y - EAVE_Y) / RIDGE_X; // 4.5:12
const THETA = Math.atan(SLOPE);
const roofY = (x: number) => EAVE_Y + (RIDGE_X - Math.abs(x - RIDGE_X)) * SLOPE;

/** Axis-aligned box from inch bounds, emitted in meters. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const g = new THREE.BoxGeometry(i2m(x1 - x0), i2m(y1 - y0), i2m(z1 - z0));
  g.translate(i2m((x0 + x1) / 2), i2m((y0 + y1) / 2), i2m((z0 + z1) / 2));
  return g;
}

/**
 * Box laid parallel to a roof slope between plan x = xa..xb.
 * `offset` is the perpendicular gap from the roof underside line to the box
 * underside (negative hangs below the roof plane).
 */
function slopedBox(xa: number, xb: number, thick: number, z0: number, z1: number, offset: number): Geo {
  const ya = roofY(xa);
  const yb = roofY(xb);
  const len = Math.hypot(xb - xa, yb - ya);
  const th = (xa + xb) / 2 > RIDGE_X ? -THETA : THETA;
  const g = new THREE.BoxGeometry(i2m(len), i2m(thick), i2m(z1 - z0));
  g.rotateZ(th);
  const d = offset + thick / 2;
  const nx = -Math.sin(th);
  const ny = Math.cos(th);
  g.translate(i2m((xa + xb) / 2 + nx * d), i2m((ya + yb) / 2 + ny * d), i2m((z0 + z1) / 2));
  return g;
}

/** Single-sided plane on a roof slope; faceUp=false gives the reed underside. */
function slopedPlane(xa: number, xb: number, z0: number, z1: number, offset: number, faceUp: boolean): Geo {
  const ya = roofY(xa);
  const yb = roofY(xb);
  const len = Math.hypot(xb - xa, yb - ya);
  const th = (xa + xb) / 2 > RIDGE_X ? -THETA : THETA;
  const g = new THREE.PlaneGeometry(i2m(len), i2m(z1 - z0));
  g.rotateX(faceUp ? -Math.PI / 2 : Math.PI / 2);
  g.rotateZ(th);
  const nx = -Math.sin(th);
  const ny = Math.cos(th);
  g.translate(i2m((xa + xb) / 2 + nx * offset), i2m((ya + yb) / 2 + ny * offset), i2m((z0 + z1) / 2));
  return g;
}

function merged(geos: Geo[], mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(mergeGeometries(geos)!, mat);
}

export function buildVenue(): { group: THREE.Group; roof: THREE.Group } {
  const group = new THREE.Group();

  const stuccoG: Geo[] = [];
  const baseG: Geo[] = [];
  const whiteG: Geo[] = [];
  const glassG: Geo[] = [];

  // Framed glass pane; adjacent panes' 1.5" frames meet as the 3" mullions.
  // axis 'x': wall runs along x (n = wall-center z); axis 'z': the reverse.
  const pane = (axis: 'x' | 'z', n: number, a0: number, a1: number, y0: number, y1: number, fw = 1.5) => {
    const fd = 4; // frame depth across the wall
    const rail = (ry0: number, ry1: number, b0: number, b1: number) =>
      axis === 'x' ? box(b0, b1, ry0, ry1, n - fd / 2, n + fd / 2) : box(n - fd / 2, n + fd / 2, ry0, ry1, b0, b1);
    whiteG.push(rail(y0, y0 + fw, a0, a1));
    whiteG.push(rail(y1 - fw, y1, a0, a1));
    whiteG.push(rail(y0 + fw, y1 - fw, a0, a0 + fw));
    whiteG.push(rail(y0 + fw, y1 - fw, a1 - fw, a1));
    glassG.push(
      axis === 'x'
        ? box(a0 + fw, a1 - fw, y0 + fw, y1 - fw, n - 0.4, n + 0.4)
        : box(n - 0.4, n + 0.4, y0 + fw, y1 - fw, a0 + fw, a1 - fw),
    );
  };

  // -------------------------------------------------------------------------
  // North wall z=0 — glass curtain wall to the deck.
  // -------------------------------------------------------------------------
  const postXs = [0, 91, 183, 363, 452, 545];
  for (const x of postXs) whiteG.push(box(x - 4, x + 4, 0, EAVE_Y, -WALL_T, 0));
  whiteG.push(box(-WALL_T, 551, 104, EAVE_Y, -WALL_T, 0)); // top plate

  // fixed bays: two lites 0–96 + transoms; the 94.5–97.5 frame band is the y=96 mullion
  for (const [a, b] of [
    [0, 91],
    [91, 183],
    [363, 452],
    [452, 545],
  ]) {
    const c0 = a + 4;
    const c1 = b - 4;
    const mid = (c0 + c1) / 2;
    pane('x', -3, c0, mid, 0, 96);
    pane('x', -3, mid, c1, 0, 96);
    pane('x', -3, c0, mid, 96, 104);
    pane('x', -3, mid, c1, 96, 104);
  }

  // slider bay 183–363: four 45" panels, 228–318 modeled open (stacked aside)
  const sliderPanel = (x0: number, x1: number, zc: number) => {
    const fw = 2.5;
    whiteG.push(box(x0, x1, 0, fw, zc - 1, zc + 1));
    whiteG.push(box(x0, x1, 96 - fw, 96, zc - 1, zc + 1));
    whiteG.push(box(x0, x0 + fw, fw, 96 - fw, zc - 1, zc + 1));
    whiteG.push(box(x1 - fw, x1, fw, 96 - fw, zc - 1, zc + 1));
    glassG.push(box(x0 + fw, x1 - fw, fw, 96 - fw, zc - 0.3, zc + 0.3));
  };
  sliderPanel(183, 228, -4.2); // closed
  sliderPanel(183, 228, -1.7); // open panel 228–273, slid west
  sliderPanel(318, 363, -1.7); // open panel 273–318, slid east
  sliderPanel(318, 363, -4.2); // closed
  whiteG.push(box(187, 359, 0, 0.75, -5.5, -0.5)); // floor track
  for (const [a, b] of [
    [187, 228],
    [228, 273],
    [273, 318],
    [318, 359],
  ]) {
    pane('x', -3, a, b, 96, 104); // transoms aligned with panel joints
  }

  // -------------------------------------------------------------------------
  // West wall x=0 — two windows, one closed solid door, rest stucco.
  // -------------------------------------------------------------------------
  const westWindow = (z0: number, z1: number) => {
    stuccoG.push(box(-WALL_T, 0, 0, WINDOW_SILL_Y, z0, z1));
    stuccoG.push(box(-WALL_T, 0, DOOR_HEAD_Y, EAVE_Y, z0, z1));
    const mid = (z0 + z1) / 2;
    pane('z', -3, z0, mid, WINDOW_SILL_Y, DOOR_HEAD_Y);
    pane('z', -3, mid, z1, WINDOW_SILL_Y, DOOR_HEAD_Y);
  };
  stuccoG.push(box(-WALL_T, 0, 0, EAVE_Y, 0, 4));
  westWindow(4, 42);
  stuccoG.push(box(-WALL_T, 0, 0, EAVE_Y, 42, 52));
  westWindow(52, 92);
  stuccoG.push(box(-WALL_T, 0, 0, EAVE_Y, 92, 129));
  // closed 36" door
  stuccoG.push(box(-WALL_T, 0, DOOR_HEAD_Y, EAVE_Y, 129, 165));
  whiteG.push(box(-5, -1, 0, DOOR_HEAD_Y, 129, 130.5));
  whiteG.push(box(-5, -1, 0, DOOR_HEAD_Y, 163.5, 165));
  whiteG.push(box(-5, -1, 82.5, DOOR_HEAD_Y, 130.5, 163.5));
  whiteG.push(box(-3.9, -2.1, 0, 82.5, 130.5, 163.5)); // leaf
  stuccoG.push(box(-WALL_T, 0, 0, EAVE_Y, 165, 419));

  // -------------------------------------------------------------------------
  // East wall x=545 — glass storefront + closed glass door, then solid.
  // -------------------------------------------------------------------------
  stuccoG.push(box(545, 551, 0, EAVE_Y, -WALL_T, 2));
  pane('z', 548, 2, 40, 0, STOREFRONT_HEAD_Y);
  pane('z', 548, 40, 78, 0, STOREFRONT_HEAD_Y);
  stuccoG.push(box(545, 551, STOREFRONT_HEAD_Y, EAVE_Y, 2, 78));
  pane('z', 548, 78, 114, 0, DOOR_HEAD_Y, 2.5); // closed glass door
  pane('z', 548, 78, 114, DOOR_HEAD_Y, STOREFRONT_HEAD_Y);
  stuccoG.push(box(545, 551, STOREFRONT_HEAD_Y, EAVE_Y, 78, 114));
  stuccoG.push(box(545, 551, 0, EAVE_Y, 114, 419));

  // SE notch stub + east lower wall
  stuccoG.push(box(484, 551, 0, EAVE_Y, 419, 425));
  stuccoG.push(box(484, 490, 0, EAVE_Y, 425, 605));

  // SW notch stub + west lower wall
  stuccoG.push(box(-WALL_T, 65, 0, EAVE_Y, 419, 425));
  stuccoG.push(box(59, 65, 0, EAVE_Y, 425, 605));

  // -------------------------------------------------------------------------
  // South wall z=599 — solid / storefront with open double doors / solid.
  // -------------------------------------------------------------------------
  stuccoG.push(box(59, 180, 0, EAVE_Y, 599, 605));
  pane('x', 602, 180, 236, 0, STOREFRONT_HEAD_Y);
  pane('x', 602, 308, 371, 0, STOREFRONT_HEAD_Y);
  pane('x', 602, 236, 272, DOOR_HEAD_Y, STOREFRONT_HEAD_Y); // transom over the opening
  pane('x', 602, 272, 308, DOOR_HEAD_Y, STOREFRONT_HEAD_Y);
  stuccoG.push(box(180, 371, STOREFRONT_HEAD_Y, EAVE_Y, 599, 605));
  stuccoG.push(box(371, 484, 0, EAVE_Y, 599, 605));

  // double door leaves swung open into the vestibule (axis-aligned at 90°)
  const openLeaf = (hx: number, dir: 1 | -1) => {
    const x0 = dir === 1 ? hx : hx - 1.9;
    const x1 = dir === 1 ? hx + 1.9 : hx;
    whiteG.push(box(x0, x1, 0, 2.5, 605, 641));
    whiteG.push(box(x0, x1, DOOR_HEAD_Y - 2.5, DOOR_HEAD_Y, 605, 641));
    whiteG.push(box(x0, x1, 2.5, DOOR_HEAD_Y - 2.5, 605, 607.5));
    whiteG.push(box(x0, x1, 2.5, DOOR_HEAD_Y - 2.5, 638.5, 641));
    glassG.push(box((x0 + x1) / 2 - 0.3, (x0 + x1) / 2 + 0.3, 2.5, DOOR_HEAD_Y - 2.5, 607.5, 638.5));
  };
  openLeaf(236, 1);
  openLeaf(308, -1);

  // -------------------------------------------------------------------------
  // Vestibule x 180–371, z 599–659 — solid cheeks, glazed south face.
  // -------------------------------------------------------------------------
  stuccoG.push(box(174, 180, 0, EAVE_Y, 605, 665));
  stuccoG.push(box(371, 377, 0, EAVE_Y, 605, 665));
  pane('x', 662, 180, 236, 0, STOREFRONT_HEAD_Y); // sidelight
  pane('x', 662, 236, 272, 0, DOOR_HEAD_Y, 2.5); // closed double doors
  pane('x', 662, 272, 308, 0, DOOR_HEAD_Y, 2.5);
  pane('x', 662, 236, 272, DOOR_HEAD_Y, STOREFRONT_HEAD_Y);
  pane('x', 662, 272, 308, DOOR_HEAD_Y, STOREFRONT_HEAD_Y);
  pane('x', 662, 308, 371, 0, STOREFRONT_HEAD_Y); // sidelight
  stuccoG.push(box(174, 377, STOREFRONT_HEAD_Y, EAVE_Y, 659, 665));

  // -------------------------------------------------------------------------
  // Annex walls — south hallways + bathrooms, open-top (no annex roof).
  // West hall 35'1"x6'6" (the north alcove gives the depth), middle hall
  // 29'2"x5'1", east hall 27'7"x4'3"; W suite 11'10"x14'4", E bath 17'9"x7'9".
  // -------------------------------------------------------------------------
  const sWindow = (a: number, b: number) => {
    stuccoG.push(box(a, b, 0, WINDOW_SILL_Y, 659, 665));
    stuccoG.push(box(a, b, DOOR_HEAD_Y, EAVE_Y, 659, 665));
    const mid = (a + b) / 2;
    pane('x', 662, a, mid, WINDOW_SILL_Y, DOOR_HEAD_Y);
    pane('x', 662, mid, b, WINDOW_SILL_Y, DOOR_HEAD_Y);
  };

  // south facade z 659-665, one line from the west cap to the vestibule cheeks
  stuccoG.push(box(-597, -526, 0, EAVE_Y, 659, 665));
  stuccoG.push(box(-526, -490, DOOR_HEAD_Y, EAVE_Y, 659, 665)); // closed service door
  whiteG.push(box(-526, -524.5, 0, DOOR_HEAD_Y, 660, 664));
  whiteG.push(box(-491.5, -490, 0, DOOR_HEAD_Y, 660, 664));
  whiteG.push(box(-524.5, -491.5, 82.5, DOOR_HEAD_Y, 660, 664));
  whiteG.push(box(-524.5, -491.5, 0, 82.5, 661.1, 662.9)); // leaf
  stuccoG.push(box(-490, -480, 0, EAVE_Y, 659, 665));
  sWindow(-480, -422);
  stuccoG.push(box(-422, -414, 0, EAVE_Y, 659, 665));
  sWindow(-414, -356);
  stuccoG.push(box(-356, -348, 0, EAVE_Y, 659, 665));
  sWindow(-348, -290);
  stuccoG.push(box(-290, 20, 0, EAVE_Y, 659, 665));
  sWindow(20, 92);
  stuccoG.push(box(92, 98, 0, EAVE_Y, 659, 665));
  sWindow(98, 170);
  stuccoG.push(box(170, 174, 0, EAVE_Y, 659, 665));
  stuccoG.push(box(377, 385, 0, EAVE_Y, 659, 665));
  sWindow(385, 457);
  stuccoG.push(box(457, 463, 0, EAVE_Y, 659, 665));
  sWindow(463, 535);
  stuccoG.push(box(535, 694, 0, EAVE_Y, 659, 665));

  // west wing: cap, suite shell, hallway north line with its 16" alcove
  stuccoG.push(box(-603, -597, 0, EAVE_Y, 415, 665)); // west wall, suite through facade
  stuccoG.push(box(-597, -449, 0, EAVE_Y, 415, 421)); // suite north
  stuccoG.push(box(-455, -449, 0, EAVE_Y, 421, 599)); // suite east
  stuccoG.push(box(-597, -500, 0, EAVE_Y, 593, 599)); // suite south / hall north
  stuccoG.push(box(-464, -455, 0, EAVE_Y, 593, 599));
  stuccoG.push(box(-500, -464, DOOR_HEAD_Y, EAVE_Y, 593, 599)); // suite doorway
  whiteG.push(box(-500, -498.5, 0, DOOR_HEAD_Y, 594, 598));
  whiteG.push(box(-465.5, -464, 0, DOOR_HEAD_Y, 594, 598));
  whiteG.push(box(-498.5, -465.5, 82.5, DOOR_HEAD_Y, 594, 598));
  stuccoG.push(box(-449, -434, 0, EAVE_Y, 593, 599));
  stuccoG.push(box(-440, -302, 0, EAVE_Y, 577, 583)); // alcove back
  stuccoG.push(box(-440, -434, 0, EAVE_Y, 583, 593)); // alcove cheeks
  stuccoG.push(box(-308, -302, 0, EAVE_Y, 583, 593));
  stuccoG.push(box(-302, 59, 0, EAVE_Y, 593, 599)); // hall north to the room's SW leg

  // west/middle divider with doorway
  stuccoG.push(box(-176, -170, 0, EAVE_Y, 599, 608));
  stuccoG.push(box(-176, -170, 0, EAVE_Y, 644, 659));
  stuccoG.push(box(-176, -170, DOOR_HEAD_Y, EAVE_Y, 608, 644));
  whiteG.push(box(-175, -171, 0, DOOR_HEAD_Y, 608, 609.5));
  whiteG.push(box(-175, -171, 0, DOOR_HEAD_Y, 642.5, 644));
  whiteG.push(box(-175, -171, 82.5, DOOR_HEAD_Y, 609.5, 642.5));

  // east wing: bath shell; its east wall doubles as the hallway cap + door
  stuccoG.push(box(490, 700, 0, EAVE_Y, 503, 509)); // bath north
  stuccoG.push(box(694, 700, 0, EAVE_Y, 509, 615)); // bath east / hall cap
  stuccoG.push(box(694, 700, DOOR_HEAD_Y, EAVE_Y, 615, 651)); // cap doorway
  stuccoG.push(box(694, 700, 0, EAVE_Y, 651, 665));
  whiteG.push(box(695, 699, 0, DOOR_HEAD_Y, 615, 616.5));
  whiteG.push(box(695, 699, 0, DOOR_HEAD_Y, 649.5, 651));
  whiteG.push(box(695, 699, 82.5, DOOR_HEAD_Y, 616.5, 649.5));
  whiteG.push(box(696.1, 697.9, 0, 82.5, 616.5, 649.5)); // leaf
  stuccoG.push(box(490, 654, 0, EAVE_Y, 599, 605)); // bath south, doorway at the east end
  stuccoG.push(box(690, 694, 0, EAVE_Y, 599, 605));
  stuccoG.push(box(654, 690, DOOR_HEAD_Y, EAVE_Y, 599, 605));
  whiteG.push(box(654, 655.5, 0, DOOR_HEAD_Y, 600, 604));
  whiteG.push(box(688.5, 690, 0, DOOR_HEAD_Y, 600, 604));
  whiteG.push(box(655.5, 688.5, 82.5, DOOR_HEAD_Y, 600, 604));

  // stall partitions + vanity counter
  whiteG.push(box(-503, -455, 0, 57, 472, 474.5));
  whiteG.push(box(-503, -455, 0, 57, 517, 519.5));
  whiteG.push(box(490, 538, 0, 57, 549, 551.5));
  whiteG.push(box(640, 694, 28, 34, 509, 531));

  // -------------------------------------------------------------------------
  // Baseboards (4" x 0.75", interior faces of solid walls only).
  // -------------------------------------------------------------------------
  const bb = 0.75;
  baseG.push(box(0, bb, 0, 4, 0, 129));
  baseG.push(box(0, bb, 0, 4, 165, 419));
  baseG.push(box(545 - bb, 545, 0, 4, 114, 419));
  baseG.push(box(484, 545, 0, 4, 419 - bb, 419));
  baseG.push(box(484 - bb, 484, 0, 4, 425, 599));
  baseG.push(box(0, 65, 0, 4, 419 - bb, 419));
  baseG.push(box(65, 65 + bb, 0, 4, 425, 599));
  baseG.push(box(65, 180, 0, 4, 599 - bb, 599));
  baseG.push(box(371, 484, 0, 4, 599 - bb, 599));
  baseG.push(box(180, 180 + bb, 0, 4, 605, 659));
  baseG.push(box(371 - bb, 371, 0, 4, 605, 659));
  // annex hallways
  baseG.push(box(-597, -500, 0, 4, 599, 599 + bb));
  baseG.push(box(-464, -434, 0, 4, 599, 599 + bb));
  baseG.push(box(-434, -308, 0, 4, 583, 583 + bb));
  baseG.push(box(-302, -176, 0, 4, 599, 599 + bb));
  baseG.push(box(-170, 59, 0, 4, 599, 599 + bb));
  baseG.push(box(59, 174 - bb, 0, 4, 605, 605 + bb));
  baseG.push(box(-597, -597 + bb, 0, 4, 599, 659));
  baseG.push(box(-597, -526, 0, 4, 659 - bb, 659));
  baseG.push(box(-490, -176, 0, 4, 659 - bb, 659));
  baseG.push(box(-170, 174, 0, 4, 659 - bb, 659));
  baseG.push(box(-176 - bb, -176, 0, 4, 599, 608));
  baseG.push(box(-176 - bb, -176, 0, 4, 644, 659));
  baseG.push(box(-170, -170 + bb, 0, 4, 599, 608));
  baseG.push(box(-170, -170 + bb, 0, 4, 644, 659));
  baseG.push(box(174 - bb, 174, 0, 4, 605, 659));
  baseG.push(box(377, 377 + bb, 0, 4, 605, 659));
  baseG.push(box(377, 654, 0, 4, 605, 605 + bb));
  baseG.push(box(690, 694, 0, 4, 605, 605 + bb));
  baseG.push(box(377, 694, 0, 4, 659 - bb, 659));
  baseG.push(box(694 - bb, 694, 0, 4, 605, 615));
  baseG.push(box(694 - bb, 694, 0, 4, 651, 659));

  // -------------------------------------------------------------------------
  // Columns + post-and-beam.
  // -------------------------------------------------------------------------
  for (const c of COLUMNS) {
    whiteG.push(box(c.cx - c.size / 2, c.cx + c.size / 2, 0, c.height, c.cz - c.size / 2, c.cz + c.size / 2));
  }
  for (const bx of [BAY_X[1], BAY_X[2]]) {
    whiteG.push(box(bx - 4, bx + 4, 102, 120, -72, 602)); // glulam 8x18, buried in the south wall
  }
  whiteG.push(box(COLUMNS[0].cx, COLUMNS[1].cx, 102, 114, 297, 303)); // tie beam 6x12

  // -------------------------------------------------------------------------
  // Floor.
  // -------------------------------------------------------------------------
  const shape = new THREE.Shape();
  ROOM_POLYGON.forEach((p, idx) => {
    if (idx === 0) shape.moveTo(i2m(p.x), i2m(-p.z));
    else shape.lineTo(i2m(p.x), i2m(-p.z));
  });
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2); // shape (x,-z) -> world (x,z), normal up

  const wood = floorWoodTextures();
  const tile = 1 / i2m(128); // ShapeGeometry UVs are meters; 1 repeat per 128"
  wood.map.repeat.set(tile, tile);
  wood.roughnessMap.repeat.set(tile, tile);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ map: wood.map, roughnessMap: wood.roughnessMap, roughness: 1, metalness: 0 }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  // -------------------------------------------------------------------------
  // Materials + merged wall meshes.
  // -------------------------------------------------------------------------
  const stuccoMat = new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.93, metalness: 0 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.5, metalness: 0 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xeaf4f8,
    transparent: true,
    opacity: 0.1,
    roughness: 0.06,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const stucco = merged(stuccoG, stuccoMat);
  stucco.castShadow = true;
  stucco.receiveShadow = true;
  const baseboards = merged(baseG, baseMat);
  baseboards.receiveShadow = true;
  const white = merged(whiteG, whiteMat);
  white.castShadow = true;
  white.receiveShadow = true;
  const glass = merged(glassG, glassMat);
  group.add(stucco, baseboards, white, glass);

  // -------------------------------------------------------------------------
  // Roof — separate group so the app can hide it Sims-style.
  // -------------------------------------------------------------------------
  const roof = new THREE.Group();
  const N_OVER = -72;
  const S_OVER = 647; // 599 + 48
  const W_EAVE = -36;
  const E_EAVE = 581; // 545 + 36
  const SKY0 = 248.5;
  const SKY1 = 296.5;
  const zc = (N_OVER + S_OVER) / 2;
  const zLen = S_OVER - N_OVER;

  const whiteRoofG: Geo[] = [];
  const roofTopG: Geo[] = [];
  const skyGlassG: Geo[] = [];
  const gableGlassG: Geo[] = [];

  // slope planes: reed underside, plain painted top 3" above
  const reed = reedTexture();
  const slopeRun = RIDGE_X - W_EAVE - (RIDGE_X - SKY0); // per-slope run eave->skylight
  const slopeLen = Math.hypot(slopeRun, slopeRun * SLOPE);
  reed.repeat.set(slopeLen / 64, zLen / 64);
  const reedMesh = merged(
    [slopedPlane(W_EAVE, SKY0, N_OVER, S_OVER, 0, false), slopedPlane(SKY1, E_EAVE, N_OVER, S_OVER, 0, false)],
    new THREE.MeshStandardMaterial({ map: reed, roughness: 0.92, metalness: 0 }),
  );
  roofTopG.push(slopedPlane(W_EAVE, SKY0, N_OVER, S_OVER, 3, true));
  roofTopG.push(slopedPlane(SKY1, E_EAVE, N_OVER, S_OVER, 3, true));
  // solid ridge caps where the roof outlives the skylight strip
  for (const [zz0, zz1] of [
    [N_OVER, -60],
    [640, S_OVER],
  ]) {
    roofTopG.push(slopedBox(SKY0, RIDGE_X, 3, zz0, zz1, 0));
    roofTopG.push(slopedBox(RIDGE_X, SKY1, 3, zz0, zz1, 0));
  }
  const roofTop = merged(roofTopG, new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.95, metalness: 0 }));
  roof.add(reedMesh, roofTop);

  // exposed rafters, 4x10 @ 42.8" o.c., instanced per slope
  const R_SPACING = 42.8;
  const rafterCount = Math.floor(zLen / R_SPACING) + 1;
  const rMargin = (zLen - (rafterCount - 1) * R_SPACING) / 2;
  const rafterMat = whiteMat;
  const m4 = new THREE.Matrix4();
  for (const [xa, xb] of [
    [W_EAVE, RIDGE_X],
    [RIDGE_X, E_EAVE],
  ]) {
    const geo = slopedBox(xa, xb, 10, -2, 2, -10);
    const im = new THREE.InstancedMesh(geo, rafterMat, rafterCount);
    for (let k = 0; k < rafterCount; k++) {
      m4.makeTranslation(0, 0, i2m(N_OVER + rMargin + k * R_SPACING));
      im.setMatrixAt(k, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    roof.add(im);
  }

  // ridge skylight strip + thin white bars
  skyGlassG.push(slopedBox(SKY0, RIDGE_X, 0.5, -60, 640, 1));
  skyGlassG.push(slopedBox(RIDGE_X, SKY1, 0.5, -60, 640, 1));
  const skyGlass = merged(
    skyGlassG,
    new THREE.MeshStandardMaterial({
      color: 0xeaf4f8,
      transparent: true,
      opacity: 0.15,
      roughness: 0.06,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  roof.add(skyGlass);
  for (const bx of [256.5, 264.5, 280.5, 288.5]) {
    whiteRoofG.push(slopedBox(bx - 0.75, bx + 0.75, 1.5, -60, 640, 1));
  }
  whiteRoofG.push(slopedBox(SKY0 - 1.25, SKY0 + 1.25, 5, N_OVER, S_OVER, -1)); // skylight curbs
  whiteRoofG.push(slopedBox(SKY1 - 1.25, SKY1 + 1.25, 5, N_OVER, S_OVER, -1));

  // ridge beam 6x14
  whiteRoofG.push(box(RIDGE_X - 3, RIDGE_X + 3, 196, 210, N_OVER, S_OVER));

  // fascias: vertical boards at both eaves, raked boards at both gable ends
  whiteRoofG.push(box(W_EAVE - 2, W_EAVE, 89, 98, N_OVER, S_OVER));
  whiteRoofG.push(box(E_EAVE, E_EAVE + 2, 89, 98, N_OVER, S_OVER));
  for (const [zz0, zz1] of [
    [N_OVER - 2, N_OVER],
    [S_OVER, S_OVER + 2],
  ]) {
    whiteRoofG.push(slopedBox(W_EAVE, RIDGE_X, 12, zz0, zz1, -6));
    whiteRoofG.push(slopedBox(RIDGE_X, E_EAVE, 12, zz0, zz1, -6));
  }

  // glazed gable triangles N & S with rake mullions
  const tri = new THREE.Shape();
  tri.moveTo(i2m(0), i2m(EAVE_Y));
  tri.lineTo(i2m(545), i2m(EAVE_Y));
  tri.lineTo(i2m(RIDGE_X), i2m(RIDGE_Y));
  const triGeo = new THREE.ShapeGeometry(tri);
  gableGlassG.push(triGeo.clone().translate(0, 0, i2m(-1)));
  gableGlassG.push(triGeo.clone().translate(0, 0, i2m(600)));
  const gableGlass = merged(gableGlassG, glassMat);
  roof.add(gableGlass);
  for (const gz of [-1, 600]) {
    for (const mx of [91, 183, RIDGE_X, 363, 452]) {
      whiteRoofG.push(box(mx - 1.5, mx + 1.5, EAVE_Y, roofY(mx), gz - 2, gz + 2));
    }
  }

  // north overhang posts down to the deck
  whiteRoofG.push(box(180, 186, 0, 102, -63, -57));
  whiteRoofG.push(box(360, 366, 0, 102, -63, -57));

  // charm props: projector rig under the ridge, warm spot fixtures on the beams
  whiteRoofG.push(box(RIDGE_X - 2, RIDGE_X + 2, 172, 196, 298, 302)); // mount pole
  const projector = new THREE.Mesh(
    box(RIDGE_X - 9, RIDGE_X + 9, 160, 172, 293, 307),
    new THREE.MeshStandardMaterial({ color: 0x2e2e30, roughness: 0.6, metalness: 0.2 }),
  );
  roof.add(projector);

  const discG: Geo[] = [];
  for (const bx of [BAY_X[1], BAY_X[2]]) {
    for (const dz of [150, 250, 350, 450]) {
      const g = new THREE.CylinderGeometry(i2m(2.5), i2m(2.5), i2m(4), 10);
      g.translate(i2m(bx), i2m(100), i2m(dz));
      discG.push(g);
    }
  }
  const discs = merged(
    discG,
    new THREE.MeshStandardMaterial({
      color: 0x30281e,
      emissive: 0xffd9a8,
      emissiveIntensity: 1.6,
      roughness: 0.4,
      metalness: 0,
    }),
  );
  roof.add(discs);

  const whiteRoof = merged(whiteRoofG, whiteMat);
  roof.add(whiteRoof);

  // roof never shadows the room, so the interior stays sunlit when shown
  roof.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  group.add(roof);

  // -------------------------------------------------------------------------
  // Annex floors — hallway wood continues the room floor; baths get 12" tile.
  // -------------------------------------------------------------------------
  const rectShape = (x0: number, x1: number, z0: number, z1: number) => {
    const s = new THREE.Shape();
    s.moveTo(i2m(x0), i2m(-z0));
    s.lineTo(i2m(x1), i2m(-z0));
    s.lineTo(i2m(x1), i2m(-z1));
    s.lineTo(i2m(x0), i2m(-z1));
    return s;
  };
  const hallFloorGeo = new THREE.ShapeGeometry([
    rectShape(-597, -170, 593, 659),
    rectShape(-434, -308, 583, 593), // alcove
    rectShape(-170, 174, 599, 659),
    rectShape(377, 700, 599, 659),
  ]);
  hallFloorGeo.rotateX(-Math.PI / 2);
  const hallFloor = new THREE.Mesh(hallFloorGeo, floor.material);
  hallFloor.receiveShadow = true;

  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 64;
  tileCanvas.height = 64;
  const tileCtx = tileCanvas.getContext('2d')!;
  tileCtx.fillStyle = '#E8E6E1';
  tileCtx.fillRect(0, 0, 64, 64);
  tileCtx.fillStyle = '#DDD9D2';
  tileCtx.fillRect(0, 0, 32, 32);
  tileCtx.fillRect(32, 32, 32, 32);
  const tileTex = new THREE.CanvasTexture(tileCanvas);
  tileTex.colorSpace = THREE.SRGBColorSpace;
  tileTex.wrapS = THREE.RepeatWrapping;
  tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(1 / i2m(24), 1 / i2m(24)); // canvas holds 2x2 checks -> 12" tiles

  const bathFloorGeo = new THREE.ShapeGeometry([rectShape(-597, -455, 421, 593), rectShape(490, 694, 509, 599)]);
  bathFloorGeo.rotateX(-Math.PI / 2);
  const bathFloor = new THREE.Mesh(
    bathFloorGeo,
    new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.5, metalness: 0 }),
  );
  bathFloor.receiveShadow = true;
  group.add(hallFloor, bathFloor);

  // -------------------------------------------------------------------------
  // Bath fixtures — suite: 3 sinks west wall, 3 stalled toilets east wall;
  // east bath: 2 stalled toilets, 2 urinals, double vanity.
  // -------------------------------------------------------------------------
  const fixtureG: Geo[] = [];
  const bx = (a: number, b: number, y0: number, y1: number, c: number, d: number) =>
    box(Math.min(a, b), Math.max(a, b), y0, y1, Math.min(c, d), Math.max(c, d));
  const ecyl = (rx: number, rz: number, y0: number, y1: number, cx: number, cz: number): Geo => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 14);
    g.scale(i2m(rx), i2m(y1 - y0), i2m(rz));
    g.translate(i2m(cx), i2m((y0 + y1) / 2), i2m(cz));
    return g;
  };
  // wx = wall face, d = +1 facing east / -1 facing west
  const toilet = (wx: number, d: number, cz: number) => {
    fixtureG.push(bx(wx + 0.5 * d, wx + 7 * d, 16, 33, cz - 9.5, cz + 9.5)); // tank
    fixtureG.push(bx(wx, wx + 7.5 * d, 33, 35, cz - 10, cz + 10)); // lid
    fixtureG.push(ecyl(9, 7, 5, 15, wx + 15 * d, cz)); // bowl
    fixtureG.push(ecyl(9.5, 7.5, 15, 16.5, wx + 14.5 * d, cz)); // seat
  };
  const sink = (wx: number, d: number, cz: number) => {
    fixtureG.push(bx(wx, wx + 12 * d, 29, 35, cz - 9, cz + 9)); // wall-hung body
    fixtureG.push(ecyl(4.5, 6.5, 35, 36.5, wx + 6.5 * d, cz)); // basin
    fixtureG.push(bx(wx, wx + 1.5 * d, 35, 41, cz - 0.75, cz + 0.75)); // faucet
    fixtureG.push(bx(wx + 1 * d, wx + 5.5 * d, 39.5, 41, cz - 0.75, cz + 0.75));
  };
  const urinal = (cx: number) => {
    fixtureG.push(box(cx - 7, cx + 7, 24, 48, 592, 599));
    fixtureG.push(box(cx - 5, cx + 5, 17, 26, 594, 599));
  };
  const vanitySink = (cx: number) => {
    fixtureG.push(ecyl(6, 4.5, 34, 35.5, cx, 520)); // basin on the counter
    fixtureG.push(box(cx - 0.75, cx + 0.75, 34, 40.5, 509.5, 511)); // faucet
    fixtureG.push(box(cx - 0.75, cx + 0.75, 39, 40.5, 511, 515.5));
  };
  for (const cz of [455, 505, 550]) sink(-597, 1, cz);
  for (const cz of [447, 496, 545]) toilet(-455, -1, cz);
  for (const cz of [530, 575]) toilet(490, 1, cz);
  for (const cx of [596, 628]) urinal(cx);
  for (const cx of [656, 680]) vanitySink(cx);

  const porcelainMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.3, metalness: 0 });
  const fixtures = merged(fixtureG, porcelainMat);
  fixtures.castShadow = true;
  fixtures.receiveShadow = true;
  group.add(fixtures);

  return { group, roof };
}
