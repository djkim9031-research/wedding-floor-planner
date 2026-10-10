import * as THREE from 'three';
import { tag } from '../render/tags';
import { i2m, ROOM_POLYGON, EAVE_Y, RIDGE_Y, RIDGE_X, WINDOW_SILL_Y, DOOR_HEAD_Y } from '../constants';
import { REED_TILE_IN, floorWoodTextures, plankPaverTextures, reedTexture } from './textures';
import { box, merged, scaleUV, type Geo } from './venue/geom';
import { hallMaterials } from './venue/materials';
import { buildHallShell } from './venue/hallShell';
import { buildHallRoof } from './venue/hallRoof';
import { buildCeilingProps, buildExitSign, buildTrackLights } from './venue/hallFixtures';

// The venue: the hall (./venue/*: shell, ceiling, fixtures — matched to the
// reference photos in reference/quad), the annex wings with hallways and
// bathrooms, and the covered entry breezeway.

/** Breezeway canopy: eaves at the annex eave (EAVE_Y) over x 100–445, ridge
 * just under the hall's — photo 02 sees its rafters through the hall's south
 * clerestory with the first ridge apex at z ≈ 662, ~26" o.c. */
const BW_RIDGE_Y = RIDGE_Y - 6;
const BW_SLOPE = (BW_RIDGE_Y - EAVE_Y) / (RIDGE_X - 100);
const BW_THETA = Math.atan(BW_SLOPE);

export function buildVenue(): { group: THREE.Group; roof: THREE.Group } {
  const group = new THREE.Group();
  const m = hallMaterials();

  // -------------------------------------------------------------------------
  // Hall: walls, glazing, posts + glulams, track lights, EXIT sign.
  // -------------------------------------------------------------------------
  const hall = buildHallShell(m);
  group.add(hall.shell, buildExitSign(m));

  const stuccoG: Geo[] = [];
  const baseG: Geo[] = [];
  const whiteG: Geo[] = [];
  const glassG: Geo[] = [];

  // Framed glass pane for the annex facades; adjacent panes' 1.5" frames
  // meet as the 3" mullions. axis 'x': wall runs along x (n = wall-center z).
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
  // Annex walls — south hallways + bathrooms (low shingle roofs in the
  // roof group).
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


  // annex baseboards (4" x 0.75")
  const bb = 0.75;
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
  // Hall floor: honey red-oak strips running E-W (u = plan x).
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
  for (const t of [wood.map, wood.roughnessMap, wood.bumpMap]) t.repeat.set(tile, tile);
  const floor = new THREE.Mesh(
    floorGeo,
    tag(new THREE.MeshStandardMaterial({
      map: wood.map,
      roughnessMap: wood.roughnessMap,
      bumpMap: wood.bumpMap,
      bumpScale: 0.02,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 1.9, // satin oak picks up the glass wall's sky sheen
    }), 'wood-floor', { clearcoat: 0.35, clearcoatRoughness: 0.2 }, 'hallFloor'),
  );
  floor.receiveShadow = true;
  group.add(floor);

  // -------------------------------------------------------------------------
  // Annex meshes.
  // -------------------------------------------------------------------------
  const stucco = merged(stuccoG, m.annex);
  stucco.castShadow = true;
  stucco.receiveShadow = true;
  const baseboards = merged(baseG, m.baseboard);
  baseboards.receiveShadow = true;
  const white = merged(whiteG, m.trim);
  white.castShadow = true;
  white.receiveShadow = true;
  const glass = merged(glassG, m.glass);
  group.add(stucco, baseboards, white, glass);

  // -------------------------------------------------------------------------
  // Roof — separate group so the app can hide it Sims-style.
  // -------------------------------------------------------------------------
  const roof = new THREE.Group();
  roof.add(buildHallRoof(m), hall.beams, buildTrackLights(m), buildCeilingProps(m));
  const reed = reedTexture();
  const m4 = new THREE.Matrix4();

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
    tag(new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.5, metalness: 0 }), 'ceramic', {}, 'bathTile'),
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

  const porcelainMat = tag(new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.3, metalness: 0 }), 'ceramic', {}, 'porcelain');
  const fixtures = merged(fixtureG, porcelainMat);
  fixtures.castShadow = true;
  fixtures.receiveShadow = true;
  group.add(fixtures);

  // -------------------------------------------------------------------------
  // Breezeway — open-air post-and-beam walk running south from the vestibule
  // to the entry court. Same 4.5:12 pitch off a lower ridge; eaves at y=108
  // over the canopy edges, no walls.
  // -------------------------------------------------------------------------
  const BW_X0 = 100;
  const BW_X1 = 445;
  const BW_Z0 = 662;
  const BW_Z1 = 1800;
  const BW_HALF = RIDGE_X - BW_X0;
  const bwRoofY = (x: number) => EAVE_Y + (BW_HALF - Math.abs(x - RIDGE_X)) * BW_SLOPE;
  const BW_RIDGE = bwRoofY(RIDGE_X);

  const bwSlopedBox = (xa: number, xb: number, thick: number, z0: number, z1: number, offset: number): Geo => {
    const ya = bwRoofY(xa);
    const yb = bwRoofY(xb);
    const len = Math.hypot(xb - xa, yb - ya);
    const th = (xa + xb) / 2 > RIDGE_X ? -BW_THETA : BW_THETA;
    const g = new THREE.BoxGeometry(i2m(len), i2m(thick), i2m(z1 - z0));
    g.rotateZ(th);
    const d = offset + thick / 2;
    g.translate(i2m((xa + xb) / 2 - Math.sin(th) * d), i2m((ya + yb) / 2 + Math.cos(th) * d), i2m((z0 + z1) / 2));
    return g;
  };
  const bwSlopedPlane = (xa: number, xb: number, z0: number, z1: number, offset: number, faceUp: boolean): Geo => {
    const ya = bwRoofY(xa);
    const yb = bwRoofY(xb);
    const len = Math.hypot(xb - xa, yb - ya);
    const th = (xa + xb) / 2 > RIDGE_X ? -BW_THETA : BW_THETA;
    const g = scaleUV(new THREE.PlaneGeometry(i2m(len), i2m(z1 - z0)), len, z1 - z0, REED_TILE_IN);
    g.rotateX(faceUp ? -Math.PI / 2 : Math.PI / 2);
    g.rotateZ(th);
    g.translate(i2m((xa + xb) / 2 - Math.sin(th) * offset), i2m((ya + yb) / 2 + Math.cos(th) * offset), i2m((z0 + z1) / 2));
    return g;
  };

  // linear plank pavers per the entry photos: mixed cream/greige/gray strips
  // running along the walk, tight sand joints
  const plank = plankPaverTextures();
  const paverTex = plank.map;
  paverTex.repeat.set(1 / i2m(96), 1 / i2m(96));
  plank.roughnessMap.repeat.copy(paverTex.repeat);
  plank.bumpMap.repeat.copy(paverTex.repeat);

  // walk drops 9" to the court over two shallow steps near the south end;
  // the same pavers run east along the east hallway's facade as a terrace
  // (the couple's lounge photos), up to the court's planting bed
  const paverSurf = (x0: number, x1: number, z0: number, z1: number, y: number): Geo => {
    const g = new THREE.ShapeGeometry(rectShape(x0, x1, z0, z1));
    g.rotateX(-Math.PI / 2);
    g.translate(0, i2m(y), 0);
    return g;
  };
  const pavers = merged(
    [
      paverSurf(76, 469, 659, 1688, -0.75),
      paverSurf(76, 469, 1688, 1706, -5.25),
      paverSurf(76, 469, 1706, 1835, -9.75),
      paverSurf(469, 560, 659, 890, -0.75), // terrace
    ],
    tag(
      new THREE.MeshStandardMaterial({ map: paverTex, roughnessMap: plank.roughnessMap, bumpMap: plank.bumpMap, bumpScale: 0.02, roughness: 1, metalness: 0 }),
      'stone',
      {},
      'pavers',
    ),
  );
  pavers.receiveShadow = true;
  group.add(pavers);

  // slab masses give the grade change its risers
  const plinth = merged(
    [
      box(76, 469, -12, -0.8, 659, 1688),
      box(76, 469, -12, -5.3, 1688, 1706),
      box(76, 469, -20, -9.8, 1706, 1835),
      box(469, 560, -12, -0.8, 659, 890),
    ],
    tag(new THREE.MeshStandardMaterial({ color: 0xaaa294, roughness: 0.95, metalness: 0 }), 'stone', {}, 'plinth'),
  );
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // two rows of 8" posts on the paver level
  const bwPostG: Geo[] = [];
  for (const px of [150, 395]) {
    for (let pz = 730; pz <= 1740; pz += 144) bwPostG.push(box(px - 4, px + 4, -0.75, EAVE_Y, pz - 4, pz + 4));
  }
  const bwPosts = merged(bwPostG, m.trim);
  bwPosts.castShadow = true;
  bwPosts.receiveShadow = true;
  group.add(bwPosts);

  // handrails at the grade change
  const railG: Geo[] = [];
  for (const rx of [160, 272.5, 385]) {
    railG.push(box(rx - 0.6, rx + 0.6, -0.75, 32, 1679, 1680.2));
    railG.push(box(rx - 0.6, rx + 0.6, -9.75, 23, 1713, 1714.2));
    const rail = new THREE.BoxGeometry(i2m(1.2), i2m(2), i2m(37));
    rail.rotateX(Math.atan2(9, 34));
    rail.translate(i2m(rx), i2m(27.5), i2m(1696.5));
    railG.push(rail);
  }
  const rails = merged(railG, tag(new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.35, metalness: 0.85 }), 'metal-stainless', {}, 'handrail'));
  rails.castShadow = true;
  group.add(rails);

  // canopy — per the satellite: a continuous glazed ridge spine, plus exactly
  // two asymmetric skylight groups: west slope near the entrance, east slope
  // near the venue. Everything else is reed. Rides the roof group so the
  // ceiling toggle clears the walk; glass never casts shadows, the white
  // glazing bars do (they draw the grid on the pavers).
  const bwReedG: Geo[] = [];
  const bwTopG: Geo[] = [];
  const bwGlassG: Geo[] = [];
  const bwBarG: Geo[] = [];
  const bwWhiteG: Geo[] = [];

  // continuous ridge spine
  bwGlassG.push(bwSlopedBox(252.5, 266.5, 0.5, BW_Z0, BW_Z1, 1));
  bwGlassG.push(bwSlopedBox(278.5, 292.5, 0.5, BW_Z0, BW_Z1, 1));

  const GROUP_E: [number, number] = [1165, 1380]; // east slope, venue side
  const GROUP_W: [number, number] = [1275, 1495]; // west slope, entrance side

  const slopeSeg = (xa: number, xb: number, z0: number, z1: number) => {
    if (z1 <= z0) return;
    bwReedG.push(bwSlopedPlane(xa, xb, z0, z1, 0, false));
    bwTopG.push(bwSlopedPlane(xa, xb, z0, z1, 3, true));
  };
  // west slope: reed except the west group band (x 140..252.5)
  slopeSeg(BW_X0, 252.5, BW_Z0, GROUP_W[0]);
  slopeSeg(BW_X0, 252.5, GROUP_W[1], BW_Z1);
  slopeSeg(BW_X0, 140, GROUP_W[0], GROUP_W[1]);
  // east slope: reed except the east group band (x 292.5..405)
  slopeSeg(292.5, BW_X1, BW_Z0, GROUP_E[0]);
  slopeSeg(292.5, BW_X1, GROUP_E[1], BW_Z1);
  slopeSeg(405, BW_X1, GROUP_E[0], GROUP_E[1]);

  const skylightGroup = (ga: number, gb: number, z0: number, z1: number) => {
    bwGlassG.push(bwSlopedBox(ga, gb, 0.5, z0, z1, 1));
    for (let j = 1; j <= 3; j++) {
      const px = ga + ((gb - ga) * j) / 4;
      bwBarG.push(bwSlopedBox(px - 0.75, px + 0.75, 1.5, z0, z1, 1.6));
    }
    const nCross = Math.round((z1 - z0) / 50);
    for (let j = 0; j <= nCross; j++) {
      const pz = z0 + ((z1 - z0) * j) / nCross;
      bwBarG.push(bwSlopedBox(ga, gb, 1.5, pz - 0.75, pz + 0.75, 1.6));
    }
  };
  skylightGroup(140, 252.5, GROUP_W[0], GROUP_W[1]);
  skylightGroup(292.5, 405, GROUP_E[0], GROUP_E[1]);

  // ridge cap, ridge beam, post headers, fascias
  bwTopG.push(bwSlopedBox(266.5, RIDGE_X, 3, BW_Z0, BW_Z1, 0));
  bwTopG.push(bwSlopedBox(RIDGE_X, 278.5, 3, BW_Z0, BW_Z1, 0));
  bwWhiteG.push(box(RIDGE_X - 3, RIDGE_X + 3, BW_RIDGE - 14, BW_RIDGE, BW_Z0, BW_Z1));
  bwWhiteG.push(box(146, 154, EAVE_Y, EAVE_Y + 12, BW_Z0, BW_Z1));
  bwWhiteG.push(box(391, 399, EAVE_Y, EAVE_Y + 12, BW_Z0, BW_Z1));
  bwWhiteG.push(box(BW_X0 - 2, BW_X0, 99, 110, BW_Z0, BW_Z1));
  bwWhiteG.push(box(BW_X1, BW_X1 + 2, 99, 110, BW_Z0, BW_Z1));
  bwWhiteG.push(bwSlopedBox(BW_X0, RIDGE_X, 12, BW_Z1, BW_Z1 + 2, -6)); // entrance rake
  bwWhiteG.push(bwSlopedBox(RIDGE_X, BW_X1, 12, BW_Z1, BW_Z1 + 2, -6));

  // exposed rafters, instanced per slope like the main roof (no shadows)
  const bwLen = BW_Z1 - BW_Z0;
  const BW_RAFTER_OC = 26;
  const bwRafterCount = Math.floor(bwLen / BW_RAFTER_OC) + 1;
  const bwRafterMargin = (bwLen - (bwRafterCount - 1) * BW_RAFTER_OC) / 2;
  for (const [xa, xb] of [
    [BW_X0, RIDGE_X],
    [RIDGE_X, BW_X1],
  ]) {
    const geo = bwSlopedBox(xa, xb, 8, -1.75, 1.75, -8);
    const im = new THREE.InstancedMesh(geo, m.trim, bwRafterCount);
    for (let k = 0; k < bwRafterCount; k++) {
      m4.makeTranslation(0, 0, i2m(BW_Z0 + bwRafterMargin + k * BW_RAFTER_OC));
      im.setMatrixAt(k, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    roof.add(im);
  }

  const bwReedMesh = merged(
    bwReedG,
    tag(new THREE.MeshStandardMaterial({ map: reed.map, bumpMap: reed.bumpMap, bumpScale: 0.06, roughness: 0.92, metalness: 0 }), 'reed', {}, 'bwReed'),
  );
  const bwTopMesh = merged(bwTopG, tag(new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.95, metalness: 0 }), 'generic', {}, 'bwRoofTop'));
  const bwGlassMesh = merged(
    bwGlassG,
    tag(new THREE.MeshStandardMaterial({
      color: 0xeaf4f8,
      transparent: true,
      opacity: 0.15,
      roughness: 0.06,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }), 'glass-clear', { thin: true, ior: 1.5 }, 'bwGlass'),
  );
  const bwBars = merged(bwBarG, m.trim);
  bwBars.castShadow = true;
  const bwWhite = merged(bwWhiteG, m.trim);
  // with the rafters in the roof group, so hiding the roof clears the walk
  // (plan views, top-down renders) the same way it clears the hall
  roof.add(bwReedMesh, bwTopMesh, bwGlassMesh, bwBars, bwWhite);

  // -------------------------------------------------------------------------
  // "2400" sign hung under the canopy at the breezeway entrance.
  // -------------------------------------------------------------------------
  const monC = document.createElement('canvas');
  monC.width = 512;
  monC.height = 192;
  const mc = monC.getContext('2d')!;
  mc.fillStyle = '#E7E0D0';
  mc.fillRect(0, 0, 512, 192);
  mc.strokeStyle = '#4A3826';
  mc.lineWidth = 16;
  mc.lineJoin = 'round';
  mc.lineCap = 'round';
  const oy = 30;
  mc.beginPath(); // 2
  mc.arc(106, oy + 34, 34, Math.PI, 0);
  mc.lineTo(72, oy + 128);
  mc.lineTo(148, oy + 128);
  mc.stroke();
  mc.beginPath(); // 4
  mc.moveTo(226, oy + 2);
  mc.lineTo(172, oy + 84);
  mc.lineTo(252, oy + 84);
  mc.moveTo(226, oy + 2);
  mc.lineTo(226, oy + 128);
  mc.stroke();
  for (const zx of [330, 438]) {
    mc.beginPath(); // 0 0
    mc.ellipse(zx, oy + 65, 34, 62, 0, 0, Math.PI * 2);
    mc.stroke();
  }
  const monTex = new THREE.CanvasTexture(monC);
  monTex.colorSpace = THREE.SRGBColorSpace;
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(i2m(72), i2m(24), i2m(2)),
    tag(new THREE.MeshStandardMaterial({ color: 0xe7e0d0, roughness: 0.85, metalness: 0.05 }), 'stucco', {}, 'signPanel'),
  );
  const signFace = new THREE.Mesh(
    new THREE.PlaneGeometry(i2m(68), i2m(22)),
    tag(new THREE.MeshStandardMaterial({ map: monTex, roughness: 0.85, metalness: 0.1 }), 'generic', {}, 'signFace'),
  );
  // hung centered on the spine, just under the canopy at the entrance
  const SIGN_Y = 150; // sign top rods reach the entrance rake
  signBoard.position.set(i2m(272.5), i2m(SIGN_Y), i2m(1796));
  signBoard.castShadow = true;
  signFace.position.set(i2m(272.5), i2m(SIGN_Y), i2m(1797.2));
  roof.add(signBoard, signFace); // hangs from the canopy, hides with it
  const rodG: Geo[] = [];
  for (const rx of [272.5 - 26, 272.5 + 26]) {
    rodG.push(box(rx - 0.5, rx + 0.5, SIGN_Y + 12, bwRoofY(rx) - 6, 1795.5, 1796.5));
  }
  const rods = merged(rodG, tag(new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.5, metalness: 0.4 }), 'metal-dark', {}, 'signRods'));
  roof.add(rods);

  // shingle roofs over the annex wings (per the satellite) — in the roof
  // group so the ceiling toggle still opens the dollhouse view
  const shingle = tag(new THREE.MeshStandardMaterial({ color: 0x8b7365, roughness: 0.95, metalness: 0 }), 'generic', {}, 'shingle');
  const annexRoofG: Geo[] = [];
  annexRoofG.push(box(-615, 59, 106, 112, 407, 599)); // west bathroom suite
  annexRoofG.push(box(-615, 174, 106, 112, 599, 671)); // west + middle hallways
  annexRoofG.push(box(490, 706, 106, 112, 491, 599)); // east bathroom
  annexRoofG.push(box(377, 706, 106, 112, 599, 671)); // east hallway
  const annexRoof = merged(annexRoofG, shingle);
  annexRoof.castShadow = true;
  annexRoof.receiveShadow = true;
  roof.add(annexRoof);

  return { group, roof };
}
