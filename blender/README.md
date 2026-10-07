# Blender renderer (`render_venue.py`)

A headless Blender 4.5 LTS script. It takes a **job directory** exported by the web
app and renders a photoreal Cycles still, or an optional 360° panorama. It writes a
16‑bit PNG and a packed `.blend` next to the job.

The script is a single file. It needs only `bpy`, and uses `numpy` when that is
present. It runs the same way inside the Blender app and with the pip `bpy` module.

```sh
# Blender app (macOS path shown)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
    -P blender/render_venue.py -- --job /path/to/job [options]

# pip bpy (Python 3.11): pip install bpy==4.5.14
python blender/render_venue.py --job /path/to/job [options]
```

## CLI

| option | meaning |
|---|---|
| `--job DIR` | job directory (required) |
| `--out DIR` | output directory (default: the job directory) |
| `--res WxH` | override `render.w/h` (panorama: `W` and `W/2`) |
| `--samples N` | max samples; beats `--preset` and `render.samples` |
| `--preset draft\|standard\|final` | 128 / 256 / 1024 samples |
| `--noise-threshold X` | adaptive-sampling threshold (default `render.noiseThreshold`, 0.02) |
| `--max-bounces N` | override `render.maxBounces` |
| `--no-denoise` | turn off OIDN |
| `--device auto\|cpu\|gpu` | `auto` tries METAL (Apple), then OPTIX/CUDA/HIP/oneAPI; falls back to CPU |
| `--threads N` | CPU threads (0 = auto) |
| `--sky auto\|exr\|nishita` | world from `sky.exr` when present (`auto`), require it (`exr`), or procedural Nishita |
| `--pano` / `--no-pano` | force or suppress the equirect panorama (`render.panorama`) |
| `--ev100 X`, `--ev-comp X` | exposure overrides (`--ev100` turns off auto exposure) |
| `--auto-exposure` | meter the camera view (64 px wide, 16 spp) and derive `ev100` |
| `--view NAME` | view transform override (`AgX`, `Standard`, `Filmic`, …) |
| `--no-blend` | skip saving `scene.blend` |
| `--no-render` | build the scene (and `.blend`) without rendering |

### Outputs
- `render.png`: 16‑bit RGB PNG, `render.w × render.h`, view transform `exposure.view` (AgX by default).
- `render_pano.png`: written instead of `render.png` when rendering a panorama.
  - Equirect, 2:1 (default `2·render.h` wide, or `render.panoW`), taken from the camera position.
  - World-aligned and level, in the same **three-equirect** layout as `sky.exr`: a three
    direction `d` lands at `u = atan2(d.z, d.x)/2π + 0.5`, with the zenith on the top row.
  - It can be used directly as a three `EquirectangularReflectionMapping` texture.
- `scene.blend`: every image packed (`file.pack_all`), compressed, saved as a copy.
  - Written unless `--no-blend` is given or `render.saveBlend` is false.

### Progress protocol (stdout)
Each event is one line: `@@WP ` followed by compact JSON. Blender and Cycles also
print to the same stream, so match `/@@WP (\{.*\})$/` anywhere in a line. The script
flushes libc stdio before every event, so in practice each event starts its own line.

```
{"ev":"stage","stage":"import|materials|lights|camera|world|meter|render|save","t":0.09, ...}
{"ev":"check","checkpoints":7,"maxErrPx":0.0001}          camera self-check against scene.json checkpoints
{"ev":"meter","lavgCd":1830.2,"ev100":13.8}               only with auto exposure
{"ev":"progress","sample":48,"of":64,"pct":75.0,"etaSec":5.2}   from bpy.app.handlers.render_stats (throttled 0.5 s)
{"ev":"warn","message":"..."}
{"ev":"result","png":"…/render.png","blend":"…/scene.blend","ms":2400,"renderMs":2300,"device":"CPU",
 "w":1920,"h":1080,"samples":256,"ev100":13.0,"sky":"exr","pano":false}
{"ev":"error","message":"...","trace":"...","code":2}
```

Cycles also prints its own `Sample n/m` lines on stdout.

**Exit codes:** 0 ok · 1 Python or render error · 2 bad job (missing or invalid
files, schema or arguments).

## Job directory contract — schema `wp-scene/1`

| file | |
|---|---|
| `scene.glb` | three.js `GLTFExporter` output, Y‑up metres. Carries **no lights and no cameras** (any that appear are deleted). |
| `scene.json` | everything else (below) |
| `sky.exr` | optional equirect sky radiance |

### Frames
- Every coordinate in `scene.json` is in **three world space** (Y‑up metres).
  - The renderer maps it with `(x, y, z) → (x, −z, y)`, a +90° rotation about X; this is the glTF importer's own conversion.
- `sun.dir` and `moon.dir` point **from the scene toward** the body.
- A light's `direction` is the direction the light **shines**.
- **Camera:** three and Blender cameras both look down local −Z with +Y up.
  - Blender's world rotation is `M · R_three`, with `M` the axis change above.
  - `fovYDeg` is the vertical FOV: `sensor_fit = VERTICAL` with a 36×24 mm sensor, so DOF uses a physical aperture.
- **Checkpoints:** `{"world": [x,y,z], "px": [x,y]}`, where `px` has its origin at the top-left of a `render.w × render.h` image.
  - The script reprojects them and emits `check`. The tests require < 0.5 px.

### Photometric units
**1 Blender radiance unit (W/m²/sr) = 683 cd/m².**

| quantity | Blender value |
|---|---|
| emitter luminance L [cd/m²] | emission strength `L/683` (× emission colour) |
| sun / moon / directional illuminance E [lux] | Sun lamp strength `E/683` (× `colorLinear`) |
| point / spot intensity I [cd] | power `I · 4π / 683` W (× `colorLinear`) |
| `sky.exr` [W/m²/sr] | Background strength `sky.cdPerUnit / 683` (1 for the default 683) |

The tests measured each factor with a white Lambert plane:
- The Sun lamp came out at 1.0000 × E/(683π).
- Point and spot lights came out at 0.9998 ×, an implied 0.018402 W per cd against 4π/683 = 0.018399.
- A spot's power is the isotropic equivalent, so it uses the same factor as a point light.

Colour conventions:
- Colours multiply, as in three: the photometric number describes a white (1,1,1) source.
- `sky.exr` must not contain the sun disc, because the sun is the lamp.

### Exposure

    stops = log2(683/1.2) − ev100 + evComp      →  film value = L/(1.2·2^ev100)·2^evComp

- The whole factor is stored as **Cycles film exposure** (`scene.cycles.film_exposure = 2^stops`),
  and the colour-management exposure stays 0.
  - Cycles' adaptive-sampling convergence test is scaled by the film exposure, but not by
    the view exposure. This keeps `noiseThreshold` display-relative in both daylight and
    candle-light scenes.
  - Measured: scaling the radiances by 100 and compensating with view exposure took 3× the
    samples. Compensating with film exposure took the same time as the unscaled scene.
  - The indirect clamp (`10 / 2^stops`) and the light threshold (`0.01 / 2^stops`) are scaled the same way.
- `exposure.view` sets the view transform (default `AgX`) and `look` sets the look (`None`).
- The app exports the EV it metered for the view, with `exposure.auto` false, so the render matches
  the editor and Photo mode.
- `exposure.auto` (or `--auto-exposure`) runs a metering pass first:
  - 64 px wide, 16 spp, no denoise, film exposure 1.
  - It takes the log-average luminance of the camera view, then sets `ev100 = log2(Lavg·100/12.5)`.

### `scene.json` fields

```jsonc
{ "schema": "wp-scene/1",                              // required, exact
  "frame": {"source": "three-yup-meters"},
  "venue": {"elevM": 119, ...},                        // Nishita altitude
  "sun":  {"dir": [x,y,z], "visible": true, "illuminanceLux": 80000,
           "colorLinear": [1,.9,.8], "angularDiameterDeg": 0.545},  // Sun lamp if visible or E > 0
  "moon": {"dir": [x,y,z], "illuminanceLux": 0.03, "colorLinear": [...]},  // Sun lamp (0.52°) if E > 0 and above horizon
  "sky":  {"file": "sky.exr", "units": "W/m2/sr", "cdPerUnit": 683, "convention": "three-equirect"},
  "camera": {"type": "perspective", "position": [...], "quaternion": [x,y,z,w], "fovYDeg": 50,
             "near": 0.05, "far": 2000, "dof": {"enabled": false, "focusM": 4.2, "fStop": 2.8}},
  "exposure": {"ev100": 6.3, "evComp": 0.75, "view": "AgX", "look": "None", "auto": false},
  "render": {"w": 1920, "h": 1080, "samples": 256, "noiseThreshold": 0.02, "denoise": "OIDN",
             "maxBounces": 8, "preset": "standard", "saveBlend": true, "panorama": false, "panoW": 4096},
  "lights": [ {"id", "kind": "point|spot|directional", "group", "position", "direction", "colorLinear",
               "intensityCd", "illuminanceLux", "halfAngleDeg", "penumbra", "radiusM",
               "castShadow", "shadowlessEmitter"} ],
  "materials": {"<material name>": PbrTag},            // authoritative, merged over glTF extras
  "objects":   {"<object name>": {"castShadow": false, "cameraOnly": true, "visible": false}},
  "checkpoints": [ {"world": [...], "px": [...]} ] }
```

Required fields:
- `schema`.
- `camera.position`, `camera.quaternion` and `camera.fovYDeg`.
- `position` for point and spot lights, and `direction` for spot and directional lights.

Everything else has a default.

Lights:
- Lights of kind `ambient`, `hemisphere` or `rect` are skipped, with a `warn` event.
- A `directional` light whose id is `sun` or `moon` is skipped because it duplicates the top-level block.
- Spot lights:
  - `spot_size = 2·halfAngle`.
  - `spot_blend = (cos(half·(1−penumbra)) − cos half)/(1 − cos half)`. This matches three's smoothstep penumbra exactly.
- `radiusM` sets the lamp radius (default 0.02 m).
- `shadowlessEmitter` names an object, mesh or material. The matching meshes are the visible flame or bulb for that lamp:
  - They get `visible_shadow = visible_diffuse = False`.
  - If only paired meshes use their material, it is not sampled as a mesh light (`emission_sampling = NONE`).
  - This way the lamp alone lights the room and nothing is counted twice.

### Materials
glTF material names are `"<role>__<suffix>"`. The tag is merged in this order:
1. The material custom property `pbr`, which comes from glTF `extras`.
2. `scene.json.materials[name]`, which wins.

If no role is found, `generic` is used. The upgrades are applied to the imported
Principled BSDF:

| role | upgrade |
|---|---|
| `glass-clear` | Replaced by the `WP_ThinGlass` group: Mix(Transparent·tint, Glossy GGX r=0) with a thin-slab Fresnel. Schlick uses `abs(N·I)` so both faces act as air→glass, and `R = 2R₀/(1+R₀)`. Transmission at normal incidence is 0.923 (tested). Shadows pass through. |
| `glass-frosted` | Principled transmission 1, roughness 0.35, IOR `ior` (1.5) |
| `glass-tableware` | Same `WP_ThinGlass` group with a near-white tint. The glasses are closed solid cylinders, so refractive glass would render them as black slugs with opaque shadows; thin glass treats each wall as a slab, like a real thin-walled glass. |
| `linen` | sheen `sheen` (0.6), sheen roughness `sheenRoughness` (0.65), roughness 0.85, Mix with Translucent `translucency` (0.15) |
| `foliage` | Mix with Translucent `translucency` (0.3), emission 0. Alpha cut-outs are moved outside the mix. |
| `wood-floor` / `wood-deck` | coat `clearcoat` (0.3 / 0.5), coat roughness 0.15 |
| `emitter-flame/led/fixture` | Emission colour = base colour, strength = `luminance`/683 (defaults 1e4 / 5e4 / 2e4 cd/m²). Flames get `visible_shadow = False`. |
| `backplate` | Pure emission, `luminance`/683. Without a luminance, a white texel maps to 0.8 of film white. Camera-only visibility; not a light. |
| `metal-stainless` | metallic 1, roughness 0.25 |
| others | imported values kept |

These tag keys apply to every role:
- `clearcoat`, `sheen`, `sheenRoughness`, `transmission` and `ior` override the imported values.
- `castShadow: false` clears `visible_shadow`.
- `cameraOnly` makes the object visible to the camera only.

`linen` and `foliage` (or any tag with `vertexColors: true`) get `COLOR_0` multiplied
into Base Color if the importer has not already wired it.

### Sky
- **`sky.exr`** is a standard equirect image:
  - The **top scanline is the zenith**.
  - Columns follow three's `equirectUv`: `u = atan2(d.z, d.x)/2π + 0.5`.
  - It is float RGB radiance in W/m²/sr and should exclude the sun disc.
- **Mapping is the identity** (Mapping node rotation 0, no mirror):
  - Cycles' equirect lookup is `u = 0.5 − atan2(D.y, D.x)/2π`.
  - For `D = (x, −z, y)` that equals three's `u`.
  - Verified by the hot-texel tests: the panorama was within 0.07 px and the aimed perspective camera within 0.14 px.
- The importance map is half the EXR width, clamped to 256–1024 px (512 for Nishita). The sky is smooth because the sun is kept separate.
- **Nishita fallback** is used when `sky.exr` is absent, or with `--sky nishita`:
  - `sun_disc` is off, since the Sun lamp is the sun. Altitude is `venue.elevM`.
  - Elevation is `asin(D.z)`.
  - `sun_rotation = 90° − atan2(D.y, D.x)`. Nishita turns clockwise from +Y; this was measured, and a test checks it.
  - Its output is already in W/m²/sr (a clear sky at 28° gives about 95 klx on the ground), so the strength is 1.

### Render settings
- Cycles on the chosen device: CPU on an Intel Mac, because Blender 4.3+ has no AMD Metal support.
- Adaptive sampling: `adaptive_threshold = noiseThreshold`.
- OIDN with albedo and normal passes, prefilter ACCURATE.
- `use_light_tree`.
- Bounces: `max_bounces = maxBounces`, transparent bounces 16.
- `blur_glossy` (Filter Glossy) 1.0; reflective and refractive caustics off.
- Persistent data on, so the metering pass and the main render share the BVH.
- Seed 0.

## glTF importer notes (Blender 4.5.14)
These are for whoever writes the three.js exporter.
- `import_scene.gltf(filepath, merge_vertices=False, import_shading='NORMALS')` is valid in 4.5, as is `import_pack_images`.
- **Material `extras` become custom properties.** `userData.pbr = {...}` arrives as `mat["pbr"]`, a dict.
  - Node `extras` become object custom properties.
- **`COLOR_0` is wired automatically:**
  - The importer adds a *Color Attribute* node and a *Mix (Multiply)* into Base Color for every material on a primitive that has `COLOR_0`.
  - The attribute is named `Color`, byte colour in the corner domain.
  - `COLOR_1` is also imported, as `Color.001`, but not wired.
  - The script only wires the colour itself when that chain is missing.
- **KHR_materials_sheen** imports as Sheen Weight 1 and Sheen Tint = `sheenColorFactor`. The script sets the weight from the tag and the tint to white.
- These extensions all round-trip: KHR_materials_transmission (Transmission Weight), KHR_materials_clearcoat (Coat Weight), KHR_materials_ior and KHR_materials_emissive_strength.
- `KHR_lights_punctual` lights and glTF cameras are imported as objects. The script deletes them and emits a warning.
- Duplicate names get `.001` suffixes. Tag lookups strip them.

## Performance notes (2019 Intel MacBook Pro, CPU)
- The defaults are adaptive sampling, OIDN and the light tree.
- The film-exposure trick stops daylight scenes from being over-sampled and night scenes from being under-sampled.
- `--preset draft` gives 128 spp for previews.
- Emitters that only exist to be seen do not enter the light tree: backplates and paired flames.
- For reference, on a 4-core Linux container the fixture scene rendered at 640×360 with 64 spp in about 19 s.

## Tests

```sh
pip install bpy==4.5.14 numpy pillow pytest
python -m pytest blender/tests -q        # about 10-15 s on 4 cores
```

- `tests/make_fixture.py` builds the test jobs with bpy:
  - It models a small scene: a floor, a wall, a table, a linen cloth with a colour attribute, a flame sphere with its paired lamp, a thin glass pane, a leaf, a steel vase, a backplate, and a stray light and camera.
  - It exports the scene with Blender's glTF exporter (Y‑up, as three.js does).
  - It writes `scene.json` in three's frame, a gradient `sky.exr`, and checkpoints projected analytically.
  - `--kind sky` writes a hot-texel sky job instead.
- `tests/test_render_venue.py` covers:
  - Checkpoint reprojection.
  - Sun, moon and spot orientation.
  - Photometric calibration: Sun lamp, point, spot and emitter, each within 5% (measured within 0.02%).
  - Thin-glass transmission.
  - Material role upgrades and `COLOR_0` wiring.
  - Sky orientation with a hot texel, as a panorama and through the perspective camera.
  - That an EXR whose first scanline is the zenith loads with the zenith on top, using a spec-minimal EXR writer.
  - The Nishita sun position.
  - End to end as a subprocess: exit 0, a `result` event, a 16‑bit PNG, under 90 s, and a `.blend` that reopens with its images packed.
  - Auto exposure.
  - Bad jobs exiting with code 2.
