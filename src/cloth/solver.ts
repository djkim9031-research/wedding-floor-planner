import {
  BEND_ITERS,
  COMPLIANCE_BEND,
  COMPLIANCE_SHEAR,
  COMPLIANCE_STRUCT,
  DAMP_HI,
  DAMP_LO,
  DAMP_T0,
  DAMP_T1,
  GRAVITY,
  SHEAR_ITERS,
  STRUCT_ITERS,
  VMAX_FACTOR,
} from './constants';
import type { ClothGrid } from './particles';

function dampingAt(simTime: number): number {
  if (simTime <= DAMP_T0) return DAMP_LO;
  if (simTime >= DAMP_T1) return DAMP_HI;
  return DAMP_LO + ((DAMP_HI - DAMP_LO) * (simTime - DAMP_T0)) / (DAMP_T1 - DAMP_T0);
}

/** Semi-implicit integrate: gravity, ramped damping, speed clamp, advect. */
export function integrate(g: ClothGrid, h: number, simTime: number): void {
  const { pos, prev, vel, count } = g;
  const damp = Math.max(0, 1 - dampingAt(simTime) * h);
  const vmax = (VMAX_FACTOR * g.spacing) / h;
  const vmax2 = vmax * vmax;
  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    let vx = vel[i3] * damp;
    let vy = (vel[i3 + 1] - GRAVITY * h) * damp;
    let vz = vel[i3 + 2] * damp;
    const v2 = vx * vx + vy * vy + vz * vz;
    if (v2 > vmax2) {
      const f = vmax / Math.sqrt(v2);
      vx *= f;
      vy *= f;
      vz *= f;
    }
    vel[i3] = vx;
    vel[i3 + 1] = vy;
    vel[i3 + 2] = vz;
    prev[i3] = pos[i3];
    prev[i3 + 1] = pos[i3 + 1];
    prev[i3 + 2] = pos[i3 + 2];
    pos[i3] += vx * h;
    pos[i3 + 1] += vy * h;
    pos[i3 + 2] += vz * h;
  }
}

/** One Gauss-Seidel pass over a distance-constraint group. XPBD form with
 * unit inverse masses: Δ = C / (2 + α/h²) along the pair direction. */
function solveGroup(
  pos: Float32Array,
  pairs: Uint32Array,
  rests: Float32Array,
  alphaTilde: number
): void {
  const m = rests.length;
  const denomBase = 2 + alphaTilde;
  for (let k = 0; k < m; k++) {
    const i3 = pairs[k * 2] * 3;
    const j3 = pairs[k * 2 + 1] * 3;
    const dx = pos[j3] - pos[i3];
    const dy = pos[j3 + 1] - pos[i3 + 1];
    const dz = pos[j3 + 2] - pos[i3 + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) continue;
    const s = (len - rests[k]) / (denomBase * len);
    const cx = dx * s;
    const cy = dy * s;
    const cz = dz * s;
    pos[i3] += cx;
    pos[i3 + 1] += cy;
    pos[i3 + 2] += cz;
    pos[j3] -= cx;
    pos[j3 + 1] -= cy;
    pos[j3 + 2] -= cz;
  }
}

/** Fixed-order constraint solve for one substep. */
export function solveConstraints(g: ClothGrid, h: number): void {
  const h2 = h * h;
  for (let it = 0; it < STRUCT_ITERS; it++) {
    solveGroup(g.pos, g.structPairs, g.structRests, COMPLIANCE_STRUCT / h2);
  }
  for (let it = 0; it < SHEAR_ITERS; it++) {
    solveGroup(g.pos, g.shearPairs, g.shearRests, COMPLIANCE_SHEAR / h2);
  }
  for (let it = 0; it < BEND_ITERS; it++) {
    solveGroup(g.pos, g.bendPairs, g.bendRests, COMPLIANCE_BEND / h2);
  }
}

/** PBD velocity update from positional change over the substep. */
export function updateVelocities(g: ClothGrid, h: number): void {
  const { pos, prev, vel, count } = g;
  const invH = 1 / h;
  for (let p = 0; p < count; p++) {
    const i3 = p * 3;
    vel[i3] = (pos[i3] - prev[i3]) * invH;
    vel[i3 + 1] = (pos[i3 + 1] - prev[i3 + 1]) * invH;
    vel[i3 + 2] = (pos[i3 + 2] - prev[i3 + 2]) * invH;
  }
}
