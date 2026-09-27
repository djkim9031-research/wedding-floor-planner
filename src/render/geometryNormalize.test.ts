import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attributeSignature, drawParts, isNormalized, mergeTransformed, normalizeGeometry } from './geometryNormalize';

function triangleSoup(withColor3: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  if (withColor3) g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0, 0, 0], 3));
  return g; // non-indexed, no normal, no uv
}

function interleaved(): THREE.BufferGeometry {
  // x y z nx ny nz u v per vertex
  const buf = new THREE.InterleavedBuffer(
    new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1]),
    8,
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(buf, 3, 3));
  g.setAttribute('uv', new THREE.InterleavedBufferAttribute(buf, 2, 6));
  g.setAttribute('foo', new THREE.Float32BufferAttribute([1, 2, 3], 1));
  g.setIndex([0, 1, 2]);
  return g;
}

function byteColors(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  const c = new Uint8Array(4 * 4).fill(255);
  c[0] = 0; // first vertex red channel 0
  g.setAttribute('color', new THREE.BufferAttribute(c, 4, true));
  return g;
}

describe('normalizeGeometry', () => {
  it('mixed inputs → identical attribute sets, Uint32 index, color(4)', () => {
    const inputs = [new THREE.BoxGeometry(1, 2, 3), triangleSoup(true), triangleSoup(false), interleaved(), byteColors(), new THREE.SphereGeometry(1, 8, 6)];
    const outs = inputs.map((g) => normalizeGeometry(g)!);
    const sigs = new Set(outs.map(attributeSignature));
    expect(sigs.size).toBe(1);
    expect([...sigs][0]).toBe('color:4:Float32Array,normal:3:Float32Array,position:3:Float32Array,uv:2:Float32Array|index:Uint32Array');
    for (const g of outs) {
      expect(isNormalized(g)).toBe(true);
      expect(g.index!.array).toBeInstanceOf(Uint32Array);
      expect(g.getAttribute('color').itemSize).toBe(4);
      expect(g.groups.length).toBe(0);
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    }
    // 3-component colors gain alpha 1; absent colors are white
    const c3 = outs[1].getAttribute('color');
    expect([c3.getX(0), c3.getY(0), c3.getZ(0), c3.getW(0)]).toEqual([1, 0, 0, 1]);
    const c0 = outs[2].getAttribute('color');
    expect([c0.getX(4), c0.getY(4), c0.getZ(4), c0.getW(4)]).toEqual([1, 1, 1, 1]);
    // normalized bytes are denormalized
    const cb = outs[4].getAttribute('color');
    expect(cb.getX(0)).toBe(0);
    expect(cb.getY(0)).toBe(1);
    // non-indexed → generated sequential index
    expect(outs[1].index!.count).toBe(6);
    // interleaved read correctly, extra attribute dropped
    expect(outs[3].getAttribute('uv').getY(2)).toBe(1);
    expect(outs[3].getAttribute('foo')).toBeUndefined();
  });

  it('bakes a mirroring matrix with flipped winding', () => {
    const g = new THREE.PlaneGeometry(1, 1); // faces +Z
    const m = new THREE.Matrix4().makeScale(1, 1, -1).setPosition(5, 0, 0);
    const out = normalizeGeometry(g, { matrix: m })!;
    const p = out.getAttribute('position');
    expect(p.getX(0)).toBeCloseTo(4.5);
    const n = out.getAttribute('normal');
    expect(n.getZ(0)).toBeCloseTo(-1);
    // geometric normal from the (re-wound) triangle agrees with the attribute
    const I = out.index!.array;
    const a = new THREE.Vector3().fromBufferAttribute(p, I[0]);
    const b = new THREE.Vector3().fromBufferAttribute(p, I[1]);
    const c = new THREE.Vector3().fromBufferAttribute(p, I[2]);
    const face = b.sub(a).cross(c.sub(a)).normalize();
    expect(face.z).toBeCloseTo(-1);
  });

  it('flat option expands to face normals', () => {
    const out = normalizeGeometry(new THREE.SphereGeometry(1, 6, 4), { flat: true })!;
    const pos = out.getAttribute('position');
    expect(out.index!.count).toBe(pos.count);
    const n = out.getAttribute('normal');
    expect(n.getX(0)).toBeCloseTo(n.getX(1));
    expect(n.getY(0)).toBeCloseTo(n.getY(2));
  });

  it('splits material groups into compacted ranges', () => {
    const g = new THREE.BoxGeometry(1, 1, 1); // 6 groups, 4 verts / 6 indices each
    const parts = drawParts(g, [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial()));
    expect(parts.length).toBe(6);
    const sub = normalizeGeometry(g, { range: parts[2].range })!;
    expect(sub.index!.count).toBe(6);
    expect(sub.getAttribute('position').count).toBe(4);
    // single material ignores groups
    expect(drawParts(g, new THREE.MeshStandardMaterial()).length).toBe(1);
    expect(normalizeGeometry(g)!.index!.count).toBe(36);
  });
});

describe('mergeTransformed (InstancedMesh expansion)', () => {
  it('bakes N placements', () => {
    const base = normalizeGeometry(new THREE.BoxGeometry(1, 1, 1))!;
    const mats = [0, 1, 2].map((k) => new THREE.Matrix4().makeTranslation(k * 10, 0, 0));
    const colors = [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)];
    const g = mergeTransformed(base, mats, colors);
    expect(g.getAttribute('position').count).toBe(3 * 24);
    expect(g.index!.count).toBe(3 * 36);
    expect(isNormalized(g)).toBe(true);
    const p = g.getAttribute('position');
    expect(p.getX(24 * 2) - p.getX(0)).toBeCloseTo(20);
    expect(Math.max(...(g.index!.array as Uint32Array))).toBe(3 * 24 - 1);
    const c = g.getAttribute('color');
    expect([c.getX(24), c.getY(24), c.getZ(24), c.getW(24)]).toEqual([0, 1, 0, 1]);
  });
});
