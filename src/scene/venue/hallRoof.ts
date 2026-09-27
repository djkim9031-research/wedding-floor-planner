import * as THREE from 'three';
import { BAY_X, RIDGE_X, RIDGE_Y } from '../../constants';
import { REED_TILE_IN, reedTexture } from '../textures';
import { RAFTER_D, RAFTER_W, box, gablePane, merged, roofY, scaleUV, slopedBox, slopedPlane, SLOPE, type Geo } from './geom';
import { GLULAM_TOP, NORTH_HEADER_TOP, SOUTH_HEADER_TOP } from './hallShell';
import type { HallMaterials } from './materials';
import { tag } from '../../render/tags';

// Hall ceiling: gable cathedral of white rafters over a fine reed/stick mat
// (sticks run along the ridge, photos 02/05), a frosted ridge skylight strip,
// clerestory glazing on both gables, and the covered deck bay's dark stained
// soffit with its fascia (photo 03). Rides the roof group (hidden in the
// editor's bird's-eye view).

export const N_OVER = -72; // covered deck bay / north rake
export const S_OVER = 647; // 599 + 48
export const W_EAVE = -36;
export const E_EAVE = 581; // 545 + 36
export const SKY0 = 248.5; // ridge skylight strip (plan x)
export const SKY1 = 296.5;
const SKY_Z0 = -60;
const SKY_Z1 = 640;
const BAY_Z1 = -6; // soffit ends at the window wall's outer face

/** Rafter centerlines (z): one on each gable wall line and nine between,
 * 60.5" o.c. — the ridge apexes in photos 02/05 fit z ≈ 49, 115, 240, 297,
 * 535, 599 — plus one carrying the south overhang. */
export const RAFTER_SPACING = 60.5;
export const RAFTER_Z: number[] = [...Array.from({ length: 11 }, (_, k) => -6 + k * RAFTER_SPACING), S_OVER - 2];

export function buildHallRoof(m: HallMaterials): THREE.Group {
  const roof = new THREE.Group();
  roof.name = 'hallRoof';
  const whiteG: Geo[] = [];
  const topG: Geo[] = [];
  const glassG: Geo[] = [];
  const skyG: Geo[] = [];
  const soffitG: Geo[] = [];
  const fasciaG: Geo[] = [];

  // --- reed/stick mat on both slopes, from the window wall to the south rake
  const reed = reedTexture();
  const reedG: Geo[] = [];
  for (const [xa, xb] of [
    [W_EAVE, SKY0],
    [SKY1, E_EAVE],
  ]) {
    const len = Math.hypot(xb - xa, (xb - xa) * SLOPE);
    reedG.push(scaleUV(slopedPlane(xa, xb, BAY_Z1, S_OVER, 0, false), len, S_OVER - BAY_Z1, REED_TILE_IN));
  }
  const reedMesh = merged(
    reedG,
    tag(
      new THREE.MeshStandardMaterial({ map: reed.map, bumpMap: reed.bumpMap, bumpScale: 0.06, roughness: 0.9, metalness: 0 }),
      'reed',
      {},
      'reedCeiling',
    ),
  );
  roof.add(reedMesh);

  // --- roof deck (exterior skin) 3" above the reed; ridge caps past the strip
  topG.push(slopedPlane(W_EAVE, SKY0, N_OVER, S_OVER, 3, true));
  topG.push(slopedPlane(SKY1, E_EAVE, N_OVER, S_OVER, 3, true));
  for (const [z0, z1] of [
    [N_OVER, SKY_Z0],
    [SKY_Z1, S_OVER],
  ]) {
    topG.push(slopedBox(SKY0, RIDGE_X, 3, z0, z1, 0));
    topG.push(slopedBox(RIDGE_X, SKY1, 3, z0, z1, 0));
  }

  // --- exposed rafters (merged; the path tracer has no instancing)
  for (const z of RAFTER_Z) {
    whiteG.push(slopedBox(W_EAVE, RIDGE_X, RAFTER_D, z - RAFTER_W / 2, z + RAFTER_W / 2, -RAFTER_D));
    whiteG.push(slopedBox(RIDGE_X, E_EAVE, RAFTER_D, z - RAFTER_W / 2, z + RAFTER_W / 2, -RAFTER_D));
  }

  // --- ridge skylight: frosted panels between white bars and curbs
  skyG.push(slopedBox(SKY0, RIDGE_X, 0.5, SKY_Z0, SKY_Z1, 0.25));
  skyG.push(slopedBox(RIDGE_X, SKY1, 0.5, SKY_Z0, SKY_Z1, 0.25));
  for (const bx of [260.5, 284.5]) whiteG.push(slopedBox(bx - 0.75, bx + 0.75, 1.5, SKY_Z0, SKY_Z1, -1.25)); // glazing bars
  whiteG.push(slopedBox(SKY0 - 1, SKY0 + 1, 4, N_OVER, S_OVER, -3.5)); // curbs
  whiteG.push(slopedBox(SKY1 - 1, SKY1 + 1, 4, N_OVER, S_OVER, -3.5));
  whiteG.push(box(RIDGE_X - 1.5, RIDGE_X + 1.5, RIDGE_Y - 6, RIDGE_Y - 0.5, SKY_Z0, SKY_Z1)); // ridge bar

  // --- covered deck bay: stained plank soffit at the rafter line, step
  // board at the window wall, beige-grey fascia on the rake (photo 03)
  const soffitTile = 96;
  for (const [xa, xb] of [
    [W_EAVE, SKY0 - 1.25],
    [SKY1 + 1.25, E_EAVE],
  ]) {
    const len = Math.hypot(xb - xa, (xb - xa) * SLOPE);
    soffitG.push(scaleUV(slopedPlane(xa, xb, N_OVER, BAY_Z1, -RAFTER_D, false), len, BAY_Z1 - N_OVER, soffitTile));
    whiteG.push(slopedBox(xa, xb, RAFTER_D, BAY_Z1 - 1, BAY_Z1, -RAFTER_D));
  }
  fasciaG.push(slopedBox(W_EAVE, RIDGE_X, 14, N_OVER - 2, N_OVER, -RAFTER_D - 2));
  fasciaG.push(slopedBox(RIDGE_X, E_EAVE, 14, N_OVER - 2, N_OVER, -RAFTER_D - 2));

  // --- south rake + eave fascias (white)
  whiteG.push(slopedBox(W_EAVE, RIDGE_X, 12, S_OVER, S_OVER + 2, -6));
  whiteG.push(slopedBox(RIDGE_X, E_EAVE, 12, S_OVER, S_OVER + 2, -6));
  const ye = roofY(W_EAVE);
  whiteG.push(box(W_EAVE - 2, W_EAVE, ye - 10, ye + 3, N_OVER, S_OVER));
  whiteG.push(box(E_EAVE, E_EAVE + 2, ye - 10, ye + 3, N_OVER, S_OVER));

  // --- clerestory glazing following both gables, with white mullions
  glassG.push(gablePane(0, 545, -3, NORTH_HEADER_TOP));
  glassG.push(gablePane(65, 484, 602, SOUTH_HEADER_TOP));
  for (const mx of [91, RIDGE_X, 452]) whiteG.push(box(mx - 1.25, mx + 1.25, NORTH_HEADER_TOP, roofY(mx), -5, -1));
  for (const mx of [110, RIDGE_X, 435]) whiteG.push(box(mx - 1.25, mx + 1.25, SOUTH_HEADER_TOP, roofY(mx), 600, 604));
  for (const bx of [BAY_X[1], BAY_X[2]]) {
    whiteG.push(box(bx - 1.25, bx + 1.25, GLULAM_TOP, roofY(bx), -5, -1));
    whiteG.push(box(bx - 1.25, bx + 1.25, GLULAM_TOP, roofY(bx), 600, 604));
  }
  // corner closers above the north header
  whiteG.push(box(-6, 0, NORTH_HEADER_TOP, roofY(0) + 1, -6, 0));
  whiteG.push(box(545, 551, NORTH_HEADER_TOP, roofY(0) + 1, -6, 0));

  const add = (geos: Geo[], mat: THREE.Material) => {
    const mesh = merged(geos, mat);
    roof.add(mesh);
    return mesh;
  };
  add(whiteG, m.trim);
  add(topG, tag(new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.95, metalness: 0 }), 'generic', {}, 'roofTop'));
  add(glassG, m.glass);
  const sky = add(skyG, m.skylight);
  sky.renderOrder = 1;
  add(soffitG, m.soffit);
  add(fasciaG, m.fascia);

  return roof;
}
