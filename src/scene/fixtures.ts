/** Light fixtures modelled after the real venue (track heads on the hall
 * beams, LED pucks on the deck posts, porch lights). Geometry lives with the
 * venue/deck builders; this registry carries the photometry so the path
 * tracer and the Blender export can place true light sources. The live
 * raster view shows fixtures as emissive geometry and only a handful of
 * aggregate lights (too many dynamic lights would stall an older GPU). */

export type FixtureGroup = 'interior' | 'deck' | 'porch';

export interface FixtureDef {
  id: string;
  kind: 'spot' | 'point';
  group: FixtureGroup;
  /** emitting point, inches, model frame (y up) */
  posIn: [number, number, number];
  /** aim point for spots, inches */
  aimIn?: [number, number, number];
  /** correlated color temperature, K */
  cct: number;
  /** peak intensity, candela */
  intensityCd: number;
  /** full beam angle for spots, degrees */
  beamDeg?: number;
  /** emitter radius, inches (soft shadows) */
  radiusIn: number;
  /** material name of the fixture's emissive lens (hidden from shadow rays) */
  lensMaterial?: string;
  /** only lit after sunset (porch/deck lighting) */
  nightOnly?: boolean;
}

import { cctToLinear } from '../sky/exposure';
import type { LightDef } from '../render/types';

const IN = 0.0254;

/** Photometric fixture → the light contract the lighting rig, the path
 * tracer and the Blender export share (meters, linear colour, half-angle). */
export function fixtureToLightDef(f: FixtureDef): LightDef {
  const position: [number, number, number] = [f.posIn[0] * IN, f.posIn[1] * IN, f.posIn[2] * IN];
  let direction: [number, number, number] | undefined;
  if (f.aimIn) {
    const d = [f.aimIn[0] - f.posIn[0], f.aimIn[1] - f.posIn[1], f.aimIn[2] - f.posIn[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    direction = [d[0] / len, d[1] / len, d[2] / len];
  }
  return {
    id: f.id,
    kind: f.kind,
    // night-only fixtures ride the rig's photocell like the porch lights
    group: f.nightOnly && f.group === 'interior' ? 'porch' : f.group,
    position,
    direction,
    colorLinear: cctToLinear(f.cct),
    cct: f.cct,
    intensityCd: f.intensityCd,
    halfAngleDeg: f.beamDeg !== undefined ? f.beamDeg / 2 : undefined,
    penumbra: 0.5,
    radiusM: f.radiusIn * IN,
    shadowlessEmitter: f.lensMaterial,
    ptMode: 'light',
  };
}

const registry = new Map<string, FixtureDef>();

/** Venue/deck builders register their fixtures as they build geometry. */
export function registerFixtures(defs: FixtureDef[]): void {
  for (const d of defs) registry.set(d.id, d);
}

export function allFixtures(): FixtureDef[] {
  return [...registry.values()];
}
