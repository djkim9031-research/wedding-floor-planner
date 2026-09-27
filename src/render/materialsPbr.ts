import * as THREE from 'three';
import type { EquirectImage, SkyState } from '../sky/types';
import { bumpScaleToStrength, normalMapFromBump } from './normalFromHeight';
import { pbrOf } from './tags';
import type { MaterialRole, PbrTag } from './types';

/** Role → physical material mapping for render scenes.
 *
 * One output material per SOURCE material (cached by uuid — item templates
 * share materials, so twenty chairs cost one material). Output is always a
 * MeshStandardMaterial or MeshPhysicalMaterial in photometric units:
 * emissive radiance in cd/m² (same units as the sky env map and lights in
 * cd / lux; the renderer applies exposure). Raster-only hacks (emissive
 * brightening, envMapIntensity boosts, bump maps) are stripped. */

export interface MaterialConvertOptions {
  /** horizon sky luminance (cd/m²) that backplates are scaled by */
  horizonLuminance: number;
  /** bump → normal baker; defaults to the canvas-reading one (DOM only) */
  normalMapFor?: (bump: THREE.Texture, strength: number) => THREE.Texture | null;
}

const PHYSICAL_ROLES = new Set<MaterialRole>(['linen', 'wood-floor', 'wood-deck', 'wood-rail', 'glass-clear', 'glass-frosted', 'glass-tableware']);
const EMITTERS = new Set<MaterialRole>(['emitter-flame', 'emitter-led', 'emitter-fixture']);

/** Materials the builder may convert (everything else is not renderable). */
export function isConvertible(m: THREE.Material): boolean {
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true || pbrOf(m)?.role === 'backplate';
}

/** three-gpu-pathtracer reads `material.castShadow` (false = invisible to
 * shadow rays). Not a three.js field, so set it untyped. */
export function setCastShadow(m: THREE.Material, v: boolean): void {
  (m as unknown as { castShadow: boolean }).castShadow = v;
}

export function castsShadow(m: THREE.Material): boolean {
  return (m as unknown as { castShadow?: boolean }).castShadow !== false;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mean luminance (cd/m²) of the sky just above the horizon (0–4° up),
 * averaged over azimuth — what distant hills are lit by. */
export function horizonLuminance(sky: Pick<SkyState, 'env'> | null | undefined): number {
  const env: EquirectImage | undefined = sky?.env;
  if (!env || !env.w || !env.h || !env.data) return 1;
  const { w, h, data } = env;
  let sum = 0;
  let n = 0;
  let bestRow = 0;
  let bestD = Infinity;
  for (let y = 0; y < h; y++) {
    const el = ((y + 0.5) / h - 0.5) * 180; // rows bottom-up, row 0 = nadir
    const d = Math.abs(el - 1);
    if (d < bestD) {
      bestD = d;
      bestRow = y;
    }
    if (el < 0 || el > 4) continue;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      sum += lum(data[o], data[o + 1], data[o + 2]);
      n++;
    }
  }
  if (!n) {
    for (let x = 0; x < w; x++) {
      const o = (bestRow * w + x) * 4;
      sum += lum(data[o], data[o + 1], data[o + 2]);
      n++;
    }
  }
  const v = sum / Math.max(n, 1);
  return Number.isFinite(v) && v > 0 ? v : 1e-3;
}

function standardToPhysical(src: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial();
  // Standard fields only (MeshPhysicalMaterial.copy would read physical
  // fields the source doesn't have)
  THREE.MeshStandardMaterial.prototype.copy.call(m, src);
  m.defines = { STANDARD: '', PHYSICAL: '' };
  return m;
}

/** Emitter hue with its largest component at 1 (glTF emissiveFactor must be
 * in 0..1) and the intensity that gives it exactly `luminance` cd/m². */
function emitterColor(c: THREE.Color, luminance: number): { hue: THREE.Color; intensity: number } {
  const m = Math.max(c.r, c.g, c.b);
  const hue = m > 1e-6 ? c.clone().multiplyScalar(1 / m) : new THREE.Color(1, 1, 1);
  return { hue, intensity: luminance / Math.max(lum(hue.r, hue.g, hue.b), 1e-6) };
}

export class PbrMaterialCache {
  /** material name → tag (every converted material) */
  readonly roles: Record<string, PbrTag> = {};
  /** names of source materials that carried no role tag */
  readonly untagged = new Set<string>();
  /** normal maps baked by this cache (owned; freed by dispose) */
  readonly generatedTextures: THREE.Texture[] = [];
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly normalMaps = new Map<string, THREE.Texture | null>();
  private untaggedSeq = 0;

  constructor(private readonly opts: MaterialConvertOptions) {}

  /** Converted material for `src` (shared per source material + variant),
   * or null when the source isn't renderable. */
  get(src: THREE.Material, variant: { vertexColors?: boolean } = {}): THREE.MeshStandardMaterial | null {
    if (!isConvertible(src)) return null;
    const key = variant.vertexColors ? `${src.uuid}|vc` : src.uuid;
    let m = this.cache.get(key);
    if (!m) {
      m = this.convert(src);
      if (variant.vertexColors) m.vertexColors = true;
      this.cache.set(key, m);
    }
    return m;
  }

  materials(): THREE.MeshStandardMaterial[] {
    return [...this.cache.values()];
  }

  /** Every texture the converted materials reference (shared + generated). */
  textures(): Set<THREE.Texture> {
    const set = new Set<THREE.Texture>();
    for (const m of this.cache.values()) {
      for (const k of Object.keys(m)) {
        const v = (m as unknown as Record<string, unknown>)[k] as THREE.Texture | undefined;
        if (v && (v as THREE.Texture).isTexture) set.add(v);
      }
    }
    return set;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.generatedTextures) t.dispose();
    this.cache.clear();
    this.normalMaps.clear();
    this.generatedTextures.length = 0;
  }

  private convert(src: THREE.Material): THREE.MeshStandardMaterial {
    let tag = pbrOf(src);
    let name = src.name;
    if (!tag) {
      tag = { role: 'generic' };
      if (!name) name = `generic__untagged${++this.untaggedSeq}`;
      this.untagged.add(`${name} (${src.type})`);
    }
    const role = tag.role;
    const out: PbrTag = { ...tag };
    // a flame sits around its own point light: never block that light
    if (role === 'emitter-flame') out.castShadow = false;

    let m: THREE.MeshStandardMaterial;
    if (role === 'backplate') {
      m = this.backplate(src);
      out.castShadow = false;
      out.cameraOnly = true;
    } else {
      const s = src as THREE.MeshStandardMaterial;
      const physical =
        (s as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ||
        PHYSICAL_ROLES.has(role) ||
        !!tag.clearcoat ||
        !!tag.sheen ||
        !!tag.transmission;
      m = (s as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? s.clone() : physical ? standardToPhysical(s) : s.clone();
      this.common(m);
      this.applyRole(m, tag);
    }
    m.name = name;
    m.userData = { pbr: out, srcUuid: src.uuid };
    if (out.castShadow === false) setCastShadow(m, false);
    this.roles[name] = out;
    return m;
  }

  /** Strip raster-only state; bump → normal. */
  private common(m: THREE.MeshStandardMaterial): void {
    m.envMap = null;
    m.envMapIntensity = 1;
    m.wireframe = false;
    m.displacementMap = null;
    m.lightMap = null;
    if (m.bumpMap) {
      if (!m.normalMap) {
        const nm = this.normalFor(m.bumpMap, bumpScaleToStrength(m.bumpScale));
        if (nm) {
          m.normalMap = nm;
          m.normalMapType = THREE.TangentSpaceNormalMap;
          m.normalScale.set(1, 1);
        }
      }
      m.bumpMap = null;
      m.bumpScale = 1;
    }
  }

  private applyRole(m: THREE.MeshStandardMaterial, tag: PbrTag): void {
    const role = tag.role;
    const p = m as THREE.MeshPhysicalMaterial;
    // photometric pipeline: only emitters emit (drops glow/brightening hacks)
    if (!EMITTERS.has(role)) {
      m.emissive.setRGB(0, 0, 0);
      m.emissiveIntensity = 0;
      m.emissiveMap = null;
    }
    if (p.isMeshPhysicalMaterial) {
      if (tag.clearcoat !== undefined) {
        p.clearcoat = tag.clearcoat;
        p.clearcoatRoughness = tag.clearcoatRoughness ?? 0.2;
      }
      if (tag.sheen !== undefined) {
        p.sheen = tag.sheen;
        p.sheenRoughness = tag.sheenRoughness ?? 0.6;
        if (p.sheenColor.r + p.sheenColor.g + p.sheenColor.b === 0) p.sheenColor.setRGB(1, 1, 1);
      }
    }
    switch (role) {
      case 'linen':
        p.sheen = tag.sheen ?? 0.5;
        p.sheenRoughness = tag.sheenRoughness ?? 0.6;
        if (p.sheenColor.r + p.sheenColor.g + p.sheenColor.b === 0) p.sheenColor.setRGB(1, 1, 1);
        m.roughness = 0.85;
        break;
      case 'foliage':
        m.side = THREE.DoubleSide;
        break;
      case 'wood-floor':
      case 'wood-deck':
      case 'wood-rail':
        p.clearcoat = tag.clearcoat ?? 0;
        p.clearcoatRoughness = tag.clearcoatRoughness ?? 0.2;
        break;
      case 'glass-clear':
      case 'glass-frosted':
        // thin single-surface glass: no volume, no attenuation
        m.color.setRGB(1, 1, 1);
        m.metalness = 0;
        m.roughness = role === 'glass-clear' ? 0.02 : 0.35;
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        m.side = THREE.DoubleSide;
        p.transmission = tag.transmission ?? 1;
        p.ior = tag.ior ?? 1.5;
        p.thickness = 0;
        p.attenuationDistance = Infinity;
        p.attenuationColor.setRGB(1, 1, 1);
        break;
      case 'glass-tableware':
        // solid glass with a thin wall; clear (no absorption)
        m.color.setRGB(1, 1, 1);
        m.metalness = 0;
        m.roughness = Math.min(m.roughness, 0.05);
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        p.transmission = tag.transmission ?? 1;
        p.ior = tag.ior ?? 1.5;
        p.thickness = 0.003;
        p.attenuationDistance = Infinity;
        p.attenuationColor.setRGB(1, 1, 1);
        break;
      case 'emitter-flame':
      case 'emitter-led':
      case 'emitter-fixture': {
        // emitted hue: the designed emissive color when set, else the base
        // color; emissive × intensity reads exactly `luminance` cd/m²
        // (emissive radiance is in env-map units)
        const hueSrc = m.emissive.r + m.emissive.g + m.emissive.b > 0 ? m.emissive : m.color;
        const { hue, intensity } = emitterColor(hueSrc, tag.luminance ?? 1000);
        m.emissive.copy(hue);
        m.emissiveIntensity = intensity;
        break;
      }
      default:
        break;
    }
  }

  /** Painted distant landscape: camera-facing emitter (map × horizon sky
   * luminance), black albedo, map alpha kept for the cut-out skyline. */
  private backplate(src: THREE.Material): THREE.MeshStandardMaterial {
    const s = src as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
    const m = new THREE.MeshStandardMaterial();
    THREE.Material.prototype.copy.call(m, src); // side, transparency, alphaTest, …
    m.color.setRGB(0, 0, 0);
    m.roughness = 1;
    m.metalness = 0;
    m.map = s.map ?? null; // alpha only (albedo is black)
    m.alphaMap = s.alphaMap ?? null;
    m.emissiveMap = s.map ?? null;
    m.emissive.setRGB(1, 1, 1);
    m.emissiveIntensity = this.opts.horizonLuminance;
    m.fog = false;
    return m;
  }


  /** time spent baking normal maps (diagnostics) */
  normalMapMs = 0;

  /** One normal map per (bump texture, strength) per build; the baked pixels
   * themselves are cached for the session in normalFromHeight. */
  private normalFor(bump: THREE.Texture, strength: number): THREE.Texture | null {
    const key = `${bump.uuid}|${strength}`;
    if (this.normalMaps.has(key)) return this.normalMaps.get(key)!;
    const t0 = performance.now();
    let tex: THREE.Texture | null = null;
    try {
      tex = this.opts.normalMapFor ? this.opts.normalMapFor(bump, strength) : normalMapFromBump(bump, strength);
      if (tex) this.generatedTextures.push(tex);
    } catch (e) {
      console.warn('render: bump→normal failed for', bump.name || bump.uuid, e);
      tex = null;
    }
    this.normalMaps.set(key, tex);
    this.normalMapMs += performance.now() - t0;
    return tex;
  }
}
