import { SELF_PAIR_CAP } from './constants';

/** Spatial-hash self-collision: symmetric particle-pair repulsion so pooled
 * fabric stacks in layers instead of collapsing flat. Runs once per frame. */
export class SelfCollider {
  private readonly tableSize: number;
  private readonly mask: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  constructor(count: number) {
    let size = 1;
    while (size < count * 2) size <<= 1;
    this.tableSize = size;
    this.mask = size - 1;
    this.head = new Int32Array(size);
    this.next = new Int32Array(count);
  }

  /** rSelf doubles as the hash cell size, so ±1 cell covers the radius. */
  apply(pos: Float32Array, count: number, nx: number, rSelf: number): void {
    const { head, next, mask } = this;
    head.fill(-1);
    const inv = 1 / rSelf;
    const r2 = rSelf * rSelf;

    for (let p = 0; p < count; p++) {
      const i3 = p * 3;
      const cx = Math.floor(pos[i3] * inv);
      const cy = Math.floor(pos[i3 + 1] * inv);
      const cz = Math.floor(pos[i3 + 2] * inv);
      const hsh = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & mask;
      next[p] = head[hsh];
      head[hsh] = p;
    }

    for (let p = 0; p < count; p++) {
      const i3 = p * 3;
      const px = pos[i3];
      const py = pos[i3 + 1];
      const pz = pos[i3 + 2];
      const cx = Math.floor(px * inv);
      const cy = Math.floor(py * inv);
      const cz = Math.floor(pz * inv);
      const ix = p % nx;
      const iz = (p / nx) | 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const hsh =
              (Math.imul(cx + ox, 73856093) ^ Math.imul(cy + oy, 19349663) ^ Math.imul(cz + oz, 83492791)) &
              mask;
            for (let q = head[hsh]; q !== -1; q = next[q]) {
              if (q <= p) continue; // each pair once
              const jx = q % nx;
              const jz = (q / nx) | 0;
              const dgx = ix - jx;
              const dgz = iz - jz;
              // immediate grid neighbors are held by constraints, not repulsion
              if (dgx <= 1 && dgx >= -1 && dgz <= 1 && dgz >= -1) continue;
              const j3 = q * 3;
              const dx = pos[j3] - pos[i3];
              const dy = pos[j3 + 1] - pos[i3 + 1];
              const dz = pos[j3 + 2] - pos[i3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= r2 || d2 < 1e-12) continue;
              const d = Math.sqrt(d2);
              let corr = rSelf - d;
              if (corr > SELF_PAIR_CAP) corr = SELF_PAIR_CAP;
              const s = (corr * 0.5) / d;
              const mx = dx * s;
              const my = dy * s;
              const mz = dz * s;
              pos[i3] -= mx;
              pos[i3 + 1] -= my;
              pos[i3 + 2] -= mz;
              pos[j3] += mx;
              pos[j3 + 1] += my;
              pos[j3 + 2] += mz;
            }
          }
        }
      }
    }
  }
}
