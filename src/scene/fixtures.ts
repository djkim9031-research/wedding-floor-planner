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

const registry = new Map<string, FixtureDef>();

/** Venue/deck builders register their fixtures as they build geometry. */
export function registerFixtures(defs: FixtureDef[]): void {
  for (const d of defs) registry.set(d.id, d);
}

export function allFixtures(): FixtureDef[] {
  return [...registry.values()];
}
