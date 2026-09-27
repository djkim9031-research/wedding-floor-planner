#!/usr/bin/env python3
"""Headless photoreal Cycles renderer for Wedding Floor Planner job directories.

Job contract: schema "wp-scene/1" (see blender/README.md). A job directory holds
``scene.glb`` (three.js GLTFExporter, Y-up metres, no lights/cameras),
``scene.json`` (camera, sun/moon, sky, lights, exposure, render settings,
material tags) and an optional ``sky.exr`` (equirect sky radiance).

Run either inside Blender::

    Blender -b --factory-startup --python-exit-code 1 -P blender/render_venue.py -- --job DIR [opts]

or with the pip ``bpy`` module::

    python blender/render_venue.py --job DIR [opts]

Units: 1 Blender radiance unit (W/m^2/sr) == 683 cd/m^2.  Emission strength is
luminance/683, a Sun lamp's strength is illuminance[lux]/683, point/spot power
is intensity[cd] * 4*pi / 683 W (all verified by blender/tests).

Progress is reported on stdout as ``@@WP {json}`` lines; exit codes are
0 ok, 1 python/render error, 2 bad job (missing/invalid files or schema).

The file is deliberately self-contained: only ``bpy``/``mathutils`` are
required, ``numpy`` is used when available.
"""

import argparse
import json
import math
import os
import re
import sys
import tempfile
import time
import traceback

try:
    import bpy
    from mathutils import Matrix, Quaternion, Vector
except ImportError:  # pragma: no cover - reported to the caller as a python error
    sys.stdout.write('@@WP {"ev":"error","message":"bpy is not available: run inside Blender '
                     'or pip install bpy==4.5.*","trace":""}\n')
    sys.stdout.flush()
    sys.exit(1)

try:  # optional speed-up for the metering pass
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None

SCHEMA = "wp-scene/1"
CD_PER_UNIT = 683.0          # cd/m^2 per Blender radiance unit (W/m^2/sr at 683 lm/W)
IN_BLENDER_BINARY = bool(getattr(bpy.app, "binary_path", ""))

ROLES = (
    "wood-floor", "wood-deck", "wood-table", "wood-rail", "reed", "paint-wall", "paint-trim",
    "stucco", "stone", "glass-clear", "glass-frosted", "glass-tableware", "linen", "fabric",
    "foliage", "bark", "metal-stainless", "metal-dark", "ceramic", "soil", "asphalt", "ground",
    "skin", "emitter-flame", "emitter-led", "emitter-fixture", "backplate", "generic",
)
EMITTER_DEFAULT_LUMINANCE = {"emitter-flame": 1.0e4, "emitter-led": 5.0e4, "emitter-fixture": 2.0e4}
PRESET_SAMPLES = {"draft": 128, "standard": 256, "final": 1024}
VERTEX_COLOR_ROLES = ("linen", "foliage")

# three (x, y, z) -> Blender (x, -z, y): a +90 degree rotation about X.
M_THREE_TO_BLENDER = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0)))

_T0 = time.time()


# --------------------------------------------------------------------------------------
# progress protocol
# --------------------------------------------------------------------------------------

def _flush_c_stdio():
    """Flush libc's stdout so Cycles' own prints never split one of our lines."""
    if os.name == "nt":
        return
    try:
        import ctypes
        ctypes.CDLL(None).fflush(None)
    except Exception:
        pass


def emit(ev, **fields):
    """Write one ``@@WP {json}`` protocol line to stdout."""
    rec = {"ev": ev}
    rec.update(fields)
    _flush_c_stdio()
    sys.stdout.write("@@WP " + json.dumps(rec, separators=(",", ":"), default=str) + "\n")
    sys.stdout.flush()


def stage(name, **extra):
    emit("stage", stage=name, t=round(time.time() - _T0, 3), **extra)


def warn(message, **extra):
    emit("warn", message=message, **extra)


class JobError(Exception):
    """Invalid or incomplete job directory (exit code 2)."""


# --------------------------------------------------------------------------------------
# argument parsing
# --------------------------------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse would sys.exit(2) with usage on stderr
        raise JobError("bad arguments: " + message)


def build_parser():
    p = _Parser(prog="render_venue.py", description="Render a wp-scene/1 job directory with Cycles.")
    p.add_argument("--job", required=True, help="job directory (scene.glb, scene.json, sky.exr)")
    p.add_argument("--out", help="output directory (default: the job directory)")
    p.add_argument("--res", help="override resolution, WxH (e.g. 1920x1080)")
    p.add_argument("--samples", type=int, help="override max samples")
    p.add_argument("--preset", choices=sorted(PRESET_SAMPLES), help="draft=128, standard=256, final=1024 samples")
    p.add_argument("--noise-threshold", type=float, help="adaptive sampling noise threshold")
    p.add_argument("--max-bounces", type=int, help="override max light bounces")
    p.add_argument("--no-denoise", action="store_true", help="disable OIDN denoising")
    p.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    p.add_argument("--threads", type=int, default=0, help="CPU threads (0 = auto)")
    p.add_argument("--sky", choices=("auto", "exr", "nishita"), default="auto",
                   help="world: sky.exr when present (auto), force exr, or procedural Nishita")
    pano = p.add_mutually_exclusive_group()
    pano.add_argument("--pano", dest="pano", action="store_true", default=None, help="render a 360 equirect panorama")
    pano.add_argument("--no-pano", dest="pano", action="store_false", help="render the still even if render.panorama")
    p.add_argument("--ev100", type=float, help="override exposure.ev100 (disables auto exposure)")
    p.add_argument("--ev-comp", type=float, help="override exposure.evComp")
    p.add_argument("--auto-exposure", action="store_true", help="meter the camera view to pick ev100")
    p.add_argument("--view", help="override view transform (e.g. AgX, Standard, Filmic)")
    p.add_argument("--no-blend", action="store_true", help="do not save the packed scene.blend")
    p.add_argument("--no-render", action="store_true", help="build the scene (and .blend) but skip rendering")
    return p


def script_argv(argv=None):
    """Arguments meant for this script (after ``--`` inside Blender, else sys.argv[1:])."""
    if argv is not None:
        return list(argv)
    args = sys.argv
    if "--" in args:
        return args[args.index("--") + 1:]
    if IN_BLENDER_BINARY:
        return []
    return args[1:]


def parse_args(argv=None):
    return build_parser().parse_args(script_argv(argv))


# --------------------------------------------------------------------------------------
# job loading / validation
# --------------------------------------------------------------------------------------

def _num_list(value, n, what):
    if not isinstance(value, (list, tuple)) or len(value) != n:
        raise JobError("%s must be a list of %d numbers" % (what, n))
    out = []
    for v in value:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise JobError("%s must contain finite numbers" % what)
        out.append(float(v))
    return out


def load_job(job_dir):
    """Read and validate ``scene.json`` in *job_dir*; returns the job dict (with ``_dir``)."""
    if not job_dir or not os.path.isdir(job_dir):
        raise JobError("job directory not found: %s" % job_dir)
    job_dir = os.path.abspath(job_dir)
    json_path = os.path.join(job_dir, "scene.json")
    glb_path = os.path.join(job_dir, "scene.glb")
    if not os.path.isfile(json_path):
        raise JobError("missing scene.json in %s" % job_dir)
    if not os.path.isfile(glb_path):
        raise JobError("missing scene.glb in %s" % job_dir)
    with open(glb_path, "rb") as fh:
        if fh.read(4) != b"glTF":
            raise JobError("scene.glb is not a binary glTF file")
    try:
        with open(json_path, "r", encoding="utf-8") as fh:
            job = json.load(fh)
    except (ValueError, UnicodeDecodeError) as exc:
        raise JobError("scene.json is not valid JSON: %s" % exc)
    if not isinstance(job, dict):
        raise JobError("scene.json must hold an object")
    if job.get("schema") != SCHEMA:
        raise JobError("unsupported schema %r (expected %r)" % (job.get("schema"), SCHEMA))

    cam = job.get("camera")
    if not isinstance(cam, dict):
        raise JobError("scene.json: camera is required")
    if cam.get("type", "perspective") != "perspective":
        raise JobError("scene.json: only perspective cameras are supported")
    _num_list(cam.get("position"), 3, "camera.position")
    q = _num_list(cam.get("quaternion"), 4, "camera.quaternion")
    if sum(c * c for c in q) < 1e-12:
        raise JobError("camera.quaternion is zero")
    fov = cam.get("fovYDeg")
    if not isinstance(fov, (int, float)) or not (0.1 <= fov < 179.0):
        raise JobError("camera.fovYDeg must be a number in [0.1, 179)")

    for key in ("render", "exposure", "sun", "moon", "sky", "venue", "materials", "objects"):
        if key in job and job[key] is not None and not isinstance(job[key], dict):
            raise JobError("scene.json: %s must be an object" % key)
    render = job.get("render") or {}
    for key in ("w", "h"):
        if key in render and (not isinstance(render[key], int) or not (8 <= render[key] <= 16384)):
            raise JobError("render.%s must be an integer in [8, 16384]" % key)
    lights = job.get("lights") or []
    if not isinstance(lights, list):
        raise JobError("scene.json: lights must be a list")
    for i, lt in enumerate(lights):
        if not isinstance(lt, dict) or "kind" not in lt:
            raise JobError("lights[%d] must be an object with a kind" % i)
        if lt["kind"] in ("point", "spot"):
            _num_list(lt.get("position"), 3, "lights[%d].position" % i)
        if lt["kind"] in ("spot", "directional"):
            _num_list(lt.get("direction"), 3, "lights[%d].direction" % i)
    sun = job.get("sun") or {}
    if sun and (sun.get("visible") or (sun.get("illuminanceLux") or 0) > 0):
        _num_list(sun.get("dir"), 3, "sun.dir")
    frame = job.get("frame") or {}
    if frame.get("source") not in (None, "three-yup-meters"):
        warn("unexpected frame.source %r; assuming three Y-up metres" % frame.get("source"))
    job["_dir"] = job_dir
    return job


# --------------------------------------------------------------------------------------
# settings resolution
# --------------------------------------------------------------------------------------

def resolve_settings(job, opts):
    """Merge scene.json render/exposure settings with CLI overrides."""
    r = job.get("render") or {}
    ex = job.get("exposure") or {}
    s = {}
    s["w"] = int(r.get("w", 1920))
    s["h"] = int(r.get("h", 1080))
    s["base_w"], s["base_h"] = s["w"], s["h"]
    if opts.res:
        m = re.match(r"^\s*(\d+)\s*[xX]\s*(\d+)\s*$", opts.res)
        if not m:
            raise JobError("--res must look like 1920x1080")
        s["w"], s["h"] = int(m.group(1)), int(m.group(2))
    preset = opts.preset or r.get("preset")
    if opts.samples:
        s["samples"] = int(opts.samples)
    elif opts.preset:
        s["samples"] = PRESET_SAMPLES[opts.preset]
    elif r.get("samples"):
        s["samples"] = int(r["samples"])
    else:
        s["samples"] = PRESET_SAMPLES.get(preset or "standard", 256)
    s["preset"] = preset or "standard"
    s["noise_threshold"] = float(opts.noise_threshold if opts.noise_threshold is not None
                                 else r.get("noiseThreshold", 0.02))
    den = r.get("denoise", "OIDN")
    s["denoise"] = (not opts.no_denoise) and den not in (None, False, "none", "None", "off", "")
    s["max_bounces"] = int(opts.max_bounces if opts.max_bounces is not None else r.get("maxBounces", 8))
    s["pano"] = bool(r.get("panorama", False)) if opts.pano is None else bool(opts.pano)
    if s["pano"]:
        pw = s["w"] if opts.res else int(r.get("panoW", 2 * s["h"]))
        pw = max(16, pw - pw % 2)
        s["w"], s["h"] = pw, pw // 2
    s["save_blend"] = (not opts.no_blend) and bool(r.get("saveBlend", True))
    s["ev100"] = float(opts.ev100 if opts.ev100 is not None else ex.get("ev100", 12.0))
    s["ev_comp"] = float(opts.ev_comp if opts.ev_comp is not None else ex.get("evComp", 0.0))
    s["auto_exposure"] = bool(opts.auto_exposure or (ex.get("auto", False) and opts.ev100 is None))
    s["view"] = opts.view or ex.get("view") or "AgX"
    s["look"] = ex.get("look") or "None"
    s["out_dir"] = os.path.abspath(opts.out or job["_dir"])
    return s


# --------------------------------------------------------------------------------------
# frames / conversions
# --------------------------------------------------------------------------------------

def to_blender(v):
    """three (x, y, z) point or direction -> Blender (x, -z, y)."""
    return Vector((float(v[0]), -float(v[2]), float(v[1])))


def camera_matrix_from_three(position, quaternion_xyzw):
    """Blender world matrix for a three camera (both look down local -Z with +Y up)."""
    x, y, z, w = [float(c) for c in quaternion_xyzw]
    q = Quaternion((w, x, y, z))
    q.normalize()
    rot = M_THREE_TO_BLENDER @ q.to_matrix()
    mat = rot.to_4x4()
    mat.translation = to_blender(position)
    return mat


def exposure_stops(ev100, ev_comp):
    """Total exposure in stops so that L[cd/m^2] -> L/(1.2 * 2^ev100) * 2^evComp on film."""
    return math.log2(CD_PER_UNIT / 1.2) - ev100 + ev_comp


def ev100_from_luminance(l_avg_cd):
    """Reflected-light meter equation (K = 12.5)."""
    return math.log2(max(l_avg_cd, 1e-6) * 100.0 / 12.5)


def point_power_watts(intensity_cd):
    """Blender point/spot power for a luminous intensity in candela.

    Cycles gives a point (and spot, whose power is defined as the isotropic
    equivalent) lamp of power P a radiant intensity of P / (4*pi) W/sr, so
    P = I[cd] / 683 * 4*pi.  Verified by tests/test_render_venue.py.
    """
    return float(intensity_cd) * 4.0 * math.pi / CD_PER_UNIT


def spot_blend_from_penumbra(half_angle_rad, penumbra):
    """Match three's smoothstep(cosOuter, cosInner) with Cycles' spot_blend.

    Cycles ramps from cos(half) over (1 - cos(half)) * blend in cosine space;
    three ramps from cos(half) up to cos(half * (1 - penumbra)).
    """
    penumbra = min(max(float(penumbra), 0.0), 1.0)
    c_out = math.cos(half_angle_rad)
    c_in = math.cos(half_angle_rad * (1.0 - penumbra))
    if 1.0 - c_out < 1e-9:
        return penumbra
    return min(max((c_in - c_out) / (1.0 - c_out), 0.0), 1.0)


def strip_suffix(name):
    """'linen__a.001' -> 'linen__a' (Blender's duplicate-name suffix)."""
    return re.sub(r"\.\d{3,}$", "", name or "")


# --------------------------------------------------------------------------------------
# scene reset / import
# --------------------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    return scene


def _op_kwargs(op, wanted):
    try:
        names = {p.identifier for p in op.get_rna_type().properties}
    except Exception:
        return {k: v for k, v in wanted.items() if k == "filepath"}
    return {k: v for k, v in wanted.items() if k in names}


def import_glb(path):
    before = set(bpy.data.objects)
    kwargs = _op_kwargs(bpy.ops.import_scene.gltf, {
        "filepath": path, "merge_vertices": False, "import_shading": "NORMALS",
        "import_pack_images": True,
    })
    try:
        res = bpy.ops.import_scene.gltf(**kwargs)
    except RuntimeError as exc:
        raise JobError("scene.glb could not be imported: %s" % exc)
    if "FINISHED" not in res:
        raise JobError("scene.glb import did not finish: %s" % (res,))
    new = [o for o in bpy.data.objects if o not in before]
    # The contract says the glb carries no lights or cameras; ignore any that appear.
    keep, removed = [], 0
    for ob in new:
        if ob.type not in ("LIGHT", "CAMERA"):
            keep.append(ob)
            continue
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
            else:
                bpy.data.cameras.remove(data)
        removed += 1
    return keep, removed


# --------------------------------------------------------------------------------------
# material helpers
# --------------------------------------------------------------------------------------

def _idprop_to_py(v):
    if hasattr(v, "to_dict"):
        return v.to_dict()
    if hasattr(v, "to_list"):
        return v.to_list()
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, dict) else v
        except ValueError:
            return v
    return v


def material_tag(mat, job_materials):
    """Merge the glTF-extras tag (custom prop ``pbr``) with scene.json.materials (authoritative)."""
    tag = {}
    if "pbr" in mat.keys():
        raw = _idprop_to_py(mat["pbr"])
        if isinstance(raw, dict):
            tag.update(raw)
    base = strip_suffix(mat.name)
    for key in (base, mat.name):
        if isinstance(job_materials.get(key), dict):
            tag.update(job_materials[key])
            break
    role = tag.get("role")
    if role not in ROLES:
        prefix = base.split("__", 1)[0] if "__" in base else ""
        role = prefix if prefix in ROLES else "generic"
    tag["role"] = role
    return tag


def find_socket(sockets, key):
    """Socket by identifier first, then by display name."""
    for s in sockets:
        if s.identifier == key:
            return s
    for s in sockets:
        if s.name == key:
            return s
    return None


def output_node(nt):
    outs = [n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"]
    for n in outs:
        if n.is_active_output:
            return n
    if outs:
        return outs[0]
    return nt.nodes.new("ShaderNodeOutputMaterial")


def principled_node(nt):
    for n in nt.nodes:
        if n.bl_idname == "ShaderNodeBsdfPrincipled":
            return n
    return None


def surface_source(nt):
    out = output_node(nt)
    surf = out.inputs["Surface"]
    return out, surf, (surf.links[0].from_socket if surf.is_linked else None)


def color_source(nt):
    """(linked socket or None, rgba default) describing the material's base colour."""
    bsdf = principled_node(nt)
    if bsdf is not None:
        sock = bsdf.inputs["Base Color"]
        return (sock.links[0].from_socket if sock.is_linked else None), tuple(sock.default_value)
    for n in nt.nodes:  # unlit / emission-style imports
        if n.bl_idname == "ShaderNodeTexImage":
            return n.outputs["Color"], (1.0, 1.0, 1.0, 1.0)
    for n in nt.nodes:
        if n.bl_idname in ("ShaderNodeEmission", "ShaderNodeBackground", "ShaderNodeBsdfDiffuse"):
            sock = n.inputs["Color"]
            return (sock.links[0].from_socket if sock.is_linked else None), tuple(sock.default_value)
    for n in nt.nodes:
        if n.bl_idname == "ShaderNodeRGB":
            return n.outputs[0], tuple(n.outputs[0].default_value)
    return None, (0.8, 0.8, 0.8, 1.0)


def feed(nt, src, default, dst):
    if src is not None:
        nt.links.new(src, dst)
    else:
        dst.default_value = default


def set_input(node, name, value):
    sock = node.inputs.get(name) if hasattr(node.inputs, "get") else None
    if sock is None:
        sock = find_socket(node.inputs, name)
    if sock is None:
        return False
    for lk in list(sock.links):
        sock.id_data.links.remove(lk)
    sock.default_value = value
    return True


def uses_color_attribute(nt):
    return any(n.bl_idname in ("ShaderNodeVertexColor", "ShaderNodeAttribute") and n.outputs[0].is_linked
               for n in nt.nodes)


def wire_vertex_colors(mat, meshes):
    """Multiply the mesh colour attribute into Base Color unless the importer already did."""
    nt = mat.node_tree
    bsdf = principled_node(nt)
    if bsdf is None or uses_color_attribute(nt):
        return False
    attr_name = None
    for me in meshes:
        if len(me.color_attributes):
            ci = me.color_attributes.render_color_index
            if ci < 0 or ci >= len(me.color_attributes):
                ci = 0
            attr_name = me.color_attributes[ci].name
            break
    if attr_name is None:
        return False
    src, default = color_source(nt)
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.name = vc.label = "WP Vertex Color"
    vc.layer_name = attr_name
    mix = nt.nodes.new("ShaderNodeMix")
    mix.name = mix.label = "WP Vertex Color Multiply"
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    find_socket(mix.inputs, "Factor_Float").default_value = 1.0
    nt.links.new(vc.outputs["Color"], find_socket(mix.inputs, "A_Color"))
    feed(nt, src, default, find_socket(mix.inputs, "B_Color"))
    nt.links.new(find_socket(mix.outputs, "Result_Color"), bsdf.inputs["Base Color"])
    return True


def thin_glass_group():
    """Node group: single-surface thin glass = Mix(Transparent, Glossy, slab Fresnel).

    Reflectance uses Schlick with |N.I| so both faces behave like an air->glass
    interface (Cycles' Fresnel node would treat back faces as glass->air and
    produce total internal reflection).  A thin slab has two interfaces:
    R_slab = 2R / (1 + R); transmission (1 - R_slab) * tint.
    """
    name = "WP_ThinGlass"
    ng = bpy.data.node_groups.get(name)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    iface = ng.interface
    iface.new_socket(name="Tint", in_out="INPUT", socket_type="NodeSocketColor")
    s_ior = iface.new_socket(name="IOR", in_out="INPUT", socket_type="NodeSocketFloat")
    s_rough = iface.new_socket(name="Roughness", in_out="INPUT", socket_type="NodeSocketFloat")
    iface.new_socket(name="Shader", in_out="OUTPUT", socket_type="NodeSocketShader")
    s_ior.default_value = 1.5
    s_rough.default_value = 0.0
    n, l = ng.nodes, ng.links
    gin = n.new("NodeGroupInput")
    gout = n.new("NodeGroupOutput")
    geo = n.new("ShaderNodeNewGeometry")

    def math_node(op, a=None, b=None):
        m = n.new("ShaderNodeMath")
        m.operation = op
        for idx, v in ((0, a), (1, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[idx].default_value = v
            else:
                l.new(v, m.inputs[idx])
        return m.outputs[0]

    dot = n.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    l.new(geo.outputs["Normal"], dot.inputs[0])
    l.new(geo.outputs["Incoming"], dot.inputs[1])
    cos_t = math_node("ABSOLUTE", find_socket(dot.outputs, "Value"))
    one_minus = math_node("SUBTRACT", 1.0, cos_t)
    pow5 = math_node("POWER", one_minus, 5.0)
    # R0 = ((n - 1) / (n + 1))^2
    n_m1 = math_node("SUBTRACT", gin.outputs["IOR"], 1.0)
    n_p1 = math_node("ADD", gin.outputs["IOR"], 1.0)
    ratio = math_node("DIVIDE", n_m1, n_p1)
    r0 = math_node("MULTIPLY", ratio, ratio)
    one_m_r0 = math_node("SUBTRACT", 1.0, r0)
    term = math_node("MULTIPLY", pow5, one_m_r0)
    refl = math_node("ADD", r0, term)
    two_r = math_node("MULTIPLY", refl, 2.0)
    one_p_r = math_node("ADD", refl, 1.0)
    r_slab = math_node("DIVIDE", two_r, one_p_r)

    transp = n.new("ShaderNodeBsdfTransparent")
    l.new(gin.outputs["Tint"], transp.inputs["Color"])
    gloss = n.new("ShaderNodeBsdfGlossy")
    gloss.distribution = "GGX"
    gloss.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    l.new(gin.outputs["Roughness"], gloss.inputs["Roughness"])
    mix = n.new("ShaderNodeMixShader")
    l.new(r_slab, mix.inputs["Fac"])
    l.new(transp.outputs[0], mix.inputs[1])
    l.new(gloss.outputs[0], mix.inputs[2])
    l.new(mix.outputs[0], gout.inputs["Shader"])
    return ng


def wrap_alpha(nt, bsdf, shader_socket):
    """Move Principled alpha outside a shader mix so cut-outs stay transparent."""
    alpha = bsdf.inputs.get("Alpha")
    if alpha is None or (not alpha.is_linked and alpha.default_value >= 0.999):
        return shader_socket
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.name = transp.label = "WP Alpha Transparent"
    amix = nt.nodes.new("ShaderNodeMixShader")
    amix.name = amix.label = "WP Alpha Mix"
    if alpha.is_linked:
        nt.links.new(alpha.links[0].from_socket, amix.inputs["Fac"])
        nt.links.remove(alpha.links[0])
    else:
        amix.inputs["Fac"].default_value = alpha.default_value
    alpha.default_value = 1.0
    nt.links.new(transp.outputs[0], amix.inputs[1])
    nt.links.new(shader_socket, amix.inputs[2])
    return amix.outputs[0]


def add_translucent_mix(mat, fac):
    """Surface = Mix(current, Translucent(base colour), fac) (+ outer alpha mix)."""
    nt = mat.node_tree
    bsdf = principled_node(nt)
    out, surf, cur = surface_source(nt)
    if cur is None:
        if bsdf is None:
            return None
        cur = bsdf.outputs["BSDF"]
    src, default = color_source(nt)
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    trans.name = trans.label = "WP Translucent"
    feed(nt, src, default, trans.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.name = mix.label = "WP Translucent Mix"
    mix.inputs["Fac"].default_value = float(fac)
    nt.links.new(cur, mix.inputs[1])
    nt.links.new(trans.outputs[0], mix.inputs[2])
    final = mix.outputs[0]
    if bsdf is not None:
        final = wrap_alpha(nt, bsdf, final)
    nt.links.new(final, surf)
    return mix


def apply_generic_tag(bsdf, tag):
    if bsdf is None:
        return
    if "clearcoat" in tag:
        set_input(bsdf, "Coat Weight", float(tag["clearcoat"]))
    if "sheen" in tag:
        set_input(bsdf, "Sheen Weight", float(tag["sheen"]))
        set_input(bsdf, "Sheen Tint", (1.0, 1.0, 1.0, 1.0))
    if "sheenRoughness" in tag:
        set_input(bsdf, "Sheen Roughness", float(tag["sheenRoughness"]))
    if "transmission" in tag:
        set_input(bsdf, "Transmission Weight", float(tag["transmission"]))
    if "ior" in tag:
        set_input(bsdf, "IOR", float(tag["ior"]))


def upgrade_material(mat, tag, meshes):
    """Apply the role upgrade to *mat*; returns a dict of per-object visibility needs."""
    role = tag["role"]
    info = {"role": role, "shadowless": False, "camera_only": False, "backplate_default": False}
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = principled_node(nt)
    apply_generic_tag(bsdf, tag)

    if (role in VERTEX_COLOR_ROLES or tag.get("vertexColors")) and meshes:
        info["vertex_colors_wired"] = wire_vertex_colors(mat, meshes)

    if role == "glass-clear":
        src, default = color_source(nt)
        rgb = default[:3]
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = thin_glass_group()
        grp.name = grp.label = "WP Thin Glass"
        if src is not None:
            nt.links.new(src, grp.inputs["Tint"])
        else:
            lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
            grp.inputs["Tint"].default_value = tuple(rgb) + (1.0,) if lum > 0.05 else (1.0, 1.0, 1.0, 1.0)
        grp.inputs["IOR"].default_value = float(tag.get("ior", 1.5))
        grp.inputs["Roughness"].default_value = 0.0
        out = output_node(nt)
        nt.links.new(grp.outputs["Shader"], out.inputs["Surface"])
        if bsdf is not None:
            nt.nodes.remove(bsdf)
    elif role == "glass-frosted" and bsdf is not None:
        set_input(bsdf, "Transmission Weight", 1.0)
        set_input(bsdf, "Roughness", 0.35)
        set_input(bsdf, "IOR", float(tag.get("ior", 1.5)))
        set_input(bsdf, "Metallic", 0.0)
    elif role == "glass-tableware" and bsdf is not None:
        set_input(bsdf, "Transmission Weight", 1.0)
        set_input(bsdf, "Roughness", 0.02)
        set_input(bsdf, "IOR", float(tag.get("ior", 1.5)))
        set_input(bsdf, "Metallic", 0.0)
        set_input(bsdf, "Alpha", 1.0)
    elif role == "linen" and bsdf is not None:
        set_input(bsdf, "Sheen Weight", float(tag.get("sheen", 0.6)))
        set_input(bsdf, "Sheen Roughness", float(tag.get("sheenRoughness", 0.65)))
        set_input(bsdf, "Sheen Tint", (1.0, 1.0, 1.0, 1.0))
        set_input(bsdf, "Roughness", 0.85)
        add_translucent_mix(mat, float(tag.get("translucency", 0.15)))
    elif role == "foliage":
        if bsdf is not None:
            set_input(bsdf, "Emission Strength", 0.0)
        add_translucent_mix(mat, float(tag.get("translucency", 0.3)))
    elif role in ("wood-floor", "wood-deck") and bsdf is not None:
        set_input(bsdf, "Coat Weight", float(tag.get("clearcoat", 0.3 if role == "wood-floor" else 0.5)))
        set_input(bsdf, "Coat Roughness", 0.15)
    elif role.startswith("emitter-"):
        lum = float(tag.get("luminance", EMITTER_DEFAULT_LUMINANCE.get(role, 1.0e4)))
        if bsdf is None:
            bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
            nt.links.new(bsdf.outputs["BSDF"], output_node(nt).inputs["Surface"])
        src, default = color_source(nt)
        em = bsdf.inputs["Emission Color"]
        for lk in list(em.links):
            nt.links.remove(lk)
        feed(nt, src, default, em)
        set_input(bsdf, "Emission Strength", lum / CD_PER_UNIT)
        info["shadowless"] = role == "emitter-flame"
    elif role == "backplate":
        src, default = color_source(nt)
        em = nt.nodes.new("ShaderNodeEmission")
        em.name = em.label = "WP Backplate Emission"
        feed(nt, src, default, em.inputs["Color"])
        if "luminance" in tag:
            em.inputs["Strength"].default_value = float(tag["luminance"]) / CD_PER_UNIT
        else:
            em.inputs["Strength"].default_value = 1.0
            info["backplate_default"] = True
        out = output_node(nt)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        mat.cycles.emission_sampling = "NONE"   # seen by the camera only, lights nothing
        info["camera_only"] = True
    elif role == "metal-stainless" and bsdf is not None:
        set_input(bsdf, "Metallic", 1.0)
        set_input(bsdf, "Roughness", 0.25)

    if tag.get("castShadow") is False:
        info["shadowless"] = True
    if tag.get("cameraOnly"):
        info["camera_only"] = True
    mat["wp_role"] = role
    return info


def make_camera_only(ob):
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob.visible_shadow = False


def setup_materials(job, objects):
    """Role upgrades for every material used by the imported meshes."""
    job_mats = job.get("materials") or {}
    users = {}
    for ob in objects:
        if ob.type != "MESH":
            continue
        for slot in ob.material_slots:
            if slot.material is not None:
                users.setdefault(slot.material, []).append(ob)
    report = {}
    for mat, obs in users.items():
        tag = material_tag(mat, job_mats)
        meshes = []
        for ob in obs:
            if ob.data not in meshes:
                meshes.append(ob.data)
        info = upgrade_material(mat, tag, meshes)
        for ob in obs:
            if info["shadowless"]:
                ob.visible_shadow = False
            if info["camera_only"]:
                make_camera_only(ob)
        report[mat.name] = info
    # per-object overrides from scene.json.objects
    job_objs = job.get("objects") or {}
    if job_objs:
        for ob in objects:
            o = job_objs.get(strip_suffix(ob.name)) or job_objs.get(ob.name)
            if not isinstance(o, dict):
                continue
            if o.get("castShadow") is False:
                ob.visible_shadow = False
            if o.get("cameraOnly"):
                make_camera_only(ob)
            if o.get("visible") is False:
                ob.hide_render = True
    return report


# --------------------------------------------------------------------------------------
# lights
# --------------------------------------------------------------------------------------

def _collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def _rgb(c, default=(1.0, 1.0, 1.0)):
    try:
        return tuple(float(v) for v in c[:3])
    except Exception:
        return default


def add_sun_lamp(name, dir_three, strength, color, angle_deg, coll):
    """Sun lamp shining from *dir_three* (scene -> sun, three frame) toward the scene."""
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = float(strength)
    ld.color = _rgb(color)
    ld.angle = math.radians(float(angle_deg))
    ob = bpy.data.objects.new(name, ld)
    coll.objects.link(ob)
    d = to_blender(dir_three).normalized()
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")   # lamp +Z toward the sun, shines along -Z
    return ob


def _objects_for_emitter(ref, objects):
    ref = strip_suffix(ref)
    hits = []
    for ob in objects:
        if ob.type != "MESH":
            continue
        if strip_suffix(ob.name) == ref or strip_suffix(ob.data.name) == ref:
            hits.append(ob)
            continue
        if any(s.material is not None and strip_suffix(s.material.name) == ref for s in ob.material_slots):
            hits.append(ob)
    return hits


def setup_lights(job, objects):
    """Sun, moon and scene.json lights. Returns the created light objects."""
    created = []
    sun = job.get("sun") or {}
    nat = _collection("WP Sun+Moon")
    if sun and (sun.get("visible") or (sun.get("illuminanceLux") or 0) > 0):
        created.append(add_sun_lamp("WP_Sun", sun["dir"], float(sun.get("illuminanceLux") or 0) / CD_PER_UNIT,
                                    sun.get("colorLinear", (1, 1, 1)), sun.get("angularDiameterDeg", 0.545), nat))
    moon = job.get("moon") or {}
    if moon and (moon.get("illuminanceLux") or 0) > 0 and moon.get("dir") and float(moon["dir"][1]) > 0:
        created.append(add_sun_lamp("WP_Moon", moon["dir"], float(moon["illuminanceLux"]) / CD_PER_UNIT,
                                    moon.get("colorLinear", (0.9, 0.92, 1.0)), moon.get("angularDiameterDeg", 0.52),
                                    nat))
    paired = set()
    for i, lt in enumerate(job.get("lights") or []):
        kind = lt.get("kind")
        lid = str(lt.get("id") or "%s%d" % (kind, i))
        if kind not in ("point", "spot", "directional"):
            warn("unsupported light kind %r (%s) skipped" % (kind, lid))
            continue
        if kind == "directional" and lid in ("sun", "moon"):
            continue  # described by the top-level sun/moon blocks
        coll = _collection("WP Lights " + str(lt.get("group") or "misc"))
        if kind == "directional":
            created.append(add_sun_lamp("WP_Light_" + lid, [-c for c in lt["direction"]],
                                        float(lt.get("illuminanceLux") or 0) / CD_PER_UNIT,
                                        lt.get("colorLinear", (1, 1, 1)), lt.get("angularDiameterDeg", 0.5), coll))
            ob = created[-1]
        elif kind in ("point", "spot"):
            ld = bpy.data.lights.new("WP_Light_" + lid, "POINT" if kind == "point" else "SPOT")
            ld.energy = point_power_watts(lt.get("intensityCd") or 0.0)
            ld.color = _rgb(lt.get("colorLinear", (1, 1, 1)))
            ld.shadow_soft_size = float(lt.get("radiusM", 0.02))
            if kind == "spot":
                half = math.radians(float(lt.get("halfAngleDeg", 30.0)))
                half = min(max(half, math.radians(0.5)), math.radians(90.0))
                ld.spot_size = 2.0 * half
                ld.spot_blend = spot_blend_from_penumbra(half, lt.get("penumbra", 0.0))
            ob = bpy.data.objects.new("WP_Light_" + lid, ld)
            coll.objects.link(ob)
            ob.location = to_blender(lt["position"])
            if kind == "spot":
                d = to_blender(lt["direction"]).normalized()
                ob.rotation_mode = "QUATERNION"
                ob.rotation_quaternion = d.to_track_quat("-Z", "Y")
            created.append(ob)
        ob["wp_id"] = lid
        if lt.get("castShadow") is False:
            ob.data.use_shadow = False
        ref = lt.get("shadowlessEmitter")
        if ref:
            hits = _objects_for_emitter(ref, objects)
            if not hits:
                warn("shadowlessEmitter %r of light %s not found" % (ref, lid))
            for em in hits:
                # the paired lamp supplies the illumination: the emitter mesh is only seen
                em.visible_shadow = False
                em.visible_diffuse = False
                paired.add(em)
    # emitter materials used only by paired meshes are not sampled as mesh lights either
    for mat in {s.material for ob in paired for s in ob.material_slots if s.material is not None}:
        users = [ob for ob in bpy.data.objects if ob.type == "MESH"
                 and any(s.material == mat for s in ob.material_slots)]
        if users and all(ob in paired for ob in users):
            mat.cycles.emission_sampling = "NONE"
    return created


# --------------------------------------------------------------------------------------
# camera
# --------------------------------------------------------------------------------------

def setup_camera(job, settings):
    cam_j = job["camera"]
    scene = bpy.context.scene
    cd = bpy.data.cameras.new("WP_Camera")
    cam = bpy.data.objects.new("WP_Camera", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cd.clip_start = max(float(cam_j.get("near", 0.05)), 1e-4)
    cd.clip_end = max(float(cam_j.get("far", 2000.0)), cd.clip_start * 2)
    mat = camera_matrix_from_three(cam_j["position"], cam_j["quaternion"])
    if settings["pano"]:
        cd.type = "PANO"
        if hasattr(cd, "panorama_type"):
            cd.panorama_type = "EQUIRECTANGULAR"
        else:  # pre-4.0 builds kept it on the Cycles settings
            cd.cycles.panorama_type = "EQUIRECTANGULAR"
        # world-aligned, level: looks along Blender +X (= three +X) with +Z up, so the
        # panorama uses the same "three-equirect" layout as sky.exr.
        cam.location = mat.translation
        cam.rotation_mode = "XYZ"
        cam.rotation_euler = (math.pi / 2.0, 0.0, -math.pi / 2.0)
    else:
        cd.type = "PERSP"
        cd.sensor_fit = "VERTICAL"
        cd.sensor_width = 36.0
        cd.sensor_height = 24.0
        cd.angle_y = math.radians(float(cam_j["fovYDeg"]))
        cam.matrix_world = mat
        dof = cam_j.get("dof") or {}
        cd.dof.use_dof = bool(dof.get("enabled", False))
        if cd.dof.use_dof:
            cd.dof.focus_distance = max(float(dof.get("focusM", 3.0)), 0.01)
            cd.dof.aperture_fstop = max(float(dof.get("fStop", 2.8)), 0.1)
    return cam


def checkpoint_errors(job, settings, cam=None):
    """Reprojection error (px) of scene.json checkpoints through the Blender camera."""
    from bpy_extras.object_utils import world_to_camera_view
    scene = bpy.context.scene
    cam = cam or scene.camera
    out = []
    if settings["pano"]:
        return out
    bw, bh = settings["base_w"], settings["base_h"]
    w, h = settings["w"], settings["h"]
    same_aspect = abs(bw / float(bh) - w / float(h)) < 1e-3
    if not same_aspect:
        return out
    bpy.context.view_layer.update()
    for cp in job.get("checkpoints") or []:
        try:
            co = world_to_camera_view(scene, cam, to_blender(cp["world"]))
            ex, ey = float(cp["px"][0]) * w / bw, float(cp["px"][1]) * h / bh
        except Exception:
            continue
        gx, gy = co.x * w, (1.0 - co.y) * h
        out.append(math.hypot(gx - ex, gy - ey))
    return out


# --------------------------------------------------------------------------------------
# world
# --------------------------------------------------------------------------------------

def setup_world(job, mode):
    """World from sky.exr (three-equirect, identity mapping) or procedural Nishita."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("WP_World")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.name = "WP Background"
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    sky = job.get("sky") or {}
    exr = os.path.join(job["_dir"], sky.get("file") or "sky.exr")
    has_exr = os.path.isfile(exr)
    if mode == "exr" and not has_exr:
        raise JobError("--sky exr requested but %s is missing" % exr)
    use_exr = has_exr and mode != "nishita"
    if use_exr:
        try:
            img = bpy.data.images.load(exr, check_existing=True)
            _ = img.size[0]
        except RuntimeError as exc:
            raise JobError("sky.exr could not be loaded: %s" % exc)
        if img.size[0] == 0:
            raise JobError("sky.exr could not be decoded")
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.name = mp.label = "WP Sky Mapping"
        mp.vector_type = "POINT"
        # Verified: Cycles' equirect u = 0.5 - atan2(D.y, D.x)/2pi with D = (x, -z, y)
        # equals three's equirectUv u = atan2(d.z, d.x)/2pi + 0.5, and both put the
        # zenith on the top scanline -> identity mapping (no rotation, no mirror).
        mp.inputs["Rotation"].default_value = (0.0, 0.0, 0.0)
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.name = env.label = "WP Sky"
        env.image = img
        env.projection = "EQUIRECTANGULAR"
        env.interpolation = "Linear"
        nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        cd_per_unit = float(sky.get("cdPerUnit", CD_PER_UNIT))
        bg.inputs["Strength"].default_value = cd_per_unit / CD_PER_UNIT
        # the sun is a lamp, so the sky is smooth: a small importance map is plenty and
        # saves seconds of CPU time per render
        world.cycles.sample_map_resolution = max(256, min(1024, img.size[0] // 2))
        return "exr"
    tex = nt.nodes.new("ShaderNodeTexSky")
    tex.name = tex.label = "WP Sky"
    tex.sky_type = "NISHITA"
    tex.sun_disc = False  # the sun is the Sun lamp
    sun = job.get("sun") or {}
    d = sun.get("dir")
    if d:
        D = to_blender(d).normalized()
        tex.sun_elevation = math.asin(max(-1.0, min(1.0, D.z)))
        # measured: Nishita puts the sun at azimuth atan2(y, x) = 90 deg - sun_rotation
        # (clockwise from +Y); tests/test_nishita_fallback_sun_position checks it
        tex.sun_rotation = (math.pi / 2.0 - math.atan2(D.y, D.x)) % (2.0 * math.pi)
    else:
        tex.sun_elevation = math.radians(30.0)
    venue = job.get("venue") or {}
    tex.altitude = min(max(float(venue.get("elevM", 0.0)), 0.0), 59999.0)
    nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0  # Nishita already outputs W/m^2/sr (~683 cd/m^2 units)
    world.cycles.sample_map_resolution = 512
    return "nishita"


# --------------------------------------------------------------------------------------
# render settings / device / exposure
# --------------------------------------------------------------------------------------

def select_device(scene, want):
    scene.cycles.device = "CPU"
    if want == "cpu":
        return "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception:
        return "CPU"
    try:
        types = [t[0] for t in prefs.get_device_types(bpy.context)]
    except Exception:
        types = []
    order = ["METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"] if sys.platform == "darwin" else \
        ["OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"]
    for t in order:
        if t not in types:
            continue
        try:
            prefs.compute_device_type = t
            prefs.refresh_devices()
            devs = [d for d in prefs.devices if d.type == t]
        except Exception:
            continue
        if devs:
            for d in prefs.devices:
                d.use = d.type == t
            scene.cycles.device = "GPU"
            return t
    try:
        prefs.compute_device_type = "NONE"
    except Exception:
        pass
    if want == "gpu":
        warn("no supported GPU found; rendering on CPU")
    return "CPU"


def apply_render_settings(scene, s, threads=0):
    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.samples = max(1, int(s["samples"]))
    c.use_adaptive_sampling = True
    c.adaptive_threshold = max(0.0, float(s["noise_threshold"]))
    c.adaptive_min_samples = 0
    c.use_denoising = bool(s["denoise"])
    if s["denoise"]:
        c.denoiser = "OPENIMAGEDENOISE"
        c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        c.denoising_prefilter = "ACCURATE"
    c.use_light_tree = True
    c.max_bounces = max(0, int(s["max_bounces"]))
    c.transparent_max_bounces = 16
    c.blur_glossy = 1.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.use_animated_seed = False
    c.seed = 0
    scene.render.use_persistent_data = True
    scene.render.resolution_x = int(s["w"])
    scene.render.resolution_y = int(s["h"])
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = False
    if threads and threads > 0:
        scene.render.threads_mode = "FIXED"
        scene.render.threads = int(threads)
    else:
        scene.render.threads_mode = "AUTO"
    ims = scene.render.image_settings
    ims.file_format = "PNG"
    ims.color_mode = "RGB"
    ims.color_depth = "16"
    ims.compression = 15
    scene.render.use_file_extension = True


def apply_color_management(scene, view, look):
    vs = scene.view_settings
    try:
        vs.view_transform = view
    except TypeError:
        warn("unknown view transform %r; using AgX" % view)
        vs.view_transform = "AgX"
    for cand in (look, "%s - %s" % (vs.view_transform, look), "None"):
        try:
            vs.look = cand
            break
        except TypeError:
            continue
    vs.exposure = 0.0
    vs.gamma = 1.0


def apply_exposure(scene, stops):
    """Put the exposure on Cycles' film so adaptive sampling, clamping and the light
    threshold all work display-relative (Cycles scales its convergence test by the
    film exposure, but not by the colour-management exposure)."""
    k = 2.0 ** float(stops)
    scene.cycles.film_exposure = k
    scene.view_settings.exposure = 0.0
    scene.cycles.sample_clamp_direct = 0.0
    scene.cycles.sample_clamp_indirect = 10.0 / k
    scene.cycles.light_sampling_threshold = min(1.0, 0.01 / k)
    scene["wp_exposure_stops"] = float(stops)


def set_backplate_defaults(report, stops):
    """Camera-only backplates without a luminance: white texel -> 0.8 of film white."""
    k = 2.0 ** float(stops)
    for name, info in report.items():
        if not info.get("backplate_default"):
            continue
        mat = bpy.data.materials.get(name)
        if mat is None:
            continue
        node = mat.node_tree.nodes.get("WP Backplate Emission")
        if node is not None:
            node.inputs["Strength"].default_value = 0.8 / k


def _read_pixels_rgb(path):
    img = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = img.size
        n = w * h
        if _np is not None:
            buf = _np.empty(n * 4, dtype=_np.float32)
            img.pixels.foreach_get(buf)
            return buf.reshape(n, 4)[:, :3]
        px = img.pixels[:]
        return [px[i * 4:i * 4 + 3] for i in range(n)]
    finally:
        bpy.data.images.remove(img)


def meter_scene(scene, settings):
    """Quick low-res render; returns the log-average scene luminance in cd/m^2."""
    r = scene.render
    c = scene.cycles
    saved = dict(w=r.resolution_x, h=r.resolution_y, samples=c.samples, adaptive=c.use_adaptive_sampling,
                 denoise=c.use_denoising, film=c.film_exposure, path=r.filepath, fmt=r.image_settings.file_format,
                 depth=r.image_settings.color_depth, mode=r.image_settings.color_mode,
                 clamp=c.sample_clamp_indirect, thr=c.light_sampling_threshold)
    aspect = settings["w"] / float(settings["h"])
    mw = 64
    mh = max(8, int(round(mw / aspect)))
    tmp = tempfile.mkdtemp(prefix="wp_meter_")
    path = os.path.join(tmp, "meter.exr")
    try:
        r.resolution_x, r.resolution_y = mw, mh
        c.samples = 16
        c.use_adaptive_sampling = False
        c.use_denoising = False
        c.film_exposure = 1.0
        c.sample_clamp_indirect = 0.0
        r.image_settings.file_format = "OPEN_EXR"
        r.image_settings.color_mode = "RGB"
        r.image_settings.color_depth = "32"
        r.filepath = path
        bpy.ops.render.render(write_still=True)
        rgb = _read_pixels_rgb(path)
        if _np is not None:
            y = rgb @ _np.array([0.2126, 0.7152, 0.0722], dtype=_np.float32)
            y = _np.nan_to_num(y, nan=0.0, posinf=0.0)
            lavg = float(_np.exp(_np.mean(_np.log(1e-7 + _np.maximum(y, 0.0)))))
        else:
            acc = 0.0
            for p in rgb:
                acc += math.log(1e-7 + max(0.0, 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]))
            lavg = math.exp(acc / max(1, len(rgb)))
    finally:
        r.resolution_x, r.resolution_y = saved["w"], saved["h"]
        c.samples = saved["samples"]
        c.use_adaptive_sampling = saved["adaptive"]
        c.use_denoising = saved["denoise"]
        c.film_exposure = saved["film"]
        c.sample_clamp_indirect = saved["clamp"]
        c.light_sampling_threshold = saved["thr"]
        r.filepath = saved["path"]
        r.image_settings.file_format = saved["fmt"]
        r.image_settings.color_mode = saved["mode"]
        r.image_settings.color_depth = saved["depth"]
        try:
            os.remove(path)
            os.rmdir(tmp)
        except OSError:
            pass
    return lavg * CD_PER_UNIT


# --------------------------------------------------------------------------------------
# rendering / saving
# --------------------------------------------------------------------------------------

_SAMPLE_RE = re.compile(r"Sample (\d+)/(\d+)")
_REMAIN_RE = re.compile(r"Remaining:\s*((?:\d+:)?\d+:\d+(?:\.\d+)?)")


def _hms_to_sec(txt):
    sec = 0.0
    for part in txt.split(":"):
        sec = sec * 60.0 + float(part)
    return sec


def render_still(scene, path):
    """Render to *path* while forwarding Cycles' sample progress as @@WP events."""
    state = {"sample": -1, "t": 0.0}

    def on_stats(*args):
        txt = args[0] if args and isinstance(args[0], str) else ""
        m = _SAMPLE_RE.search(txt)
        if not m:
            return
        n, of = int(m.group(1)), int(m.group(2))
        now = time.time()
        if n == state["sample"] or (now - state["t"] < 0.5 and n != of):
            return
        state["sample"], state["t"] = n, now
        rec = {"sample": n, "of": of, "pct": round(100.0 * n / max(of, 1), 1)}
        rm = _REMAIN_RE.search(txt)
        if rm:
            try:
                rec["etaSec"] = round(_hms_to_sec(rm.group(1)), 1)
            except ValueError:
                pass
        emit("progress", **rec)

    scene.render.filepath = path
    handlers = bpy.app.handlers.render_stats
    handlers.append(on_stats)
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        # a handler left registered can hang interpreter shutdown with pip bpy
        while on_stats in handlers:
            handlers.remove(on_stats)
    if not os.path.isfile(path):
        raise RuntimeError("render finished but %s was not written" % path)


def save_blend(path):
    try:
        bpy.ops.file.pack_all()
    except RuntimeError as exc:
        warn("pack_all failed: %s" % exc)
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True, compress=True, check_existing=False)


# --------------------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------------------

def build_scene(job, opts, settings=None):
    """Everything up to (but excluding) the render. Returns a context dict."""
    settings = settings or resolve_settings(job, opts)
    ctx = {"settings": settings}

    stage("import")
    scene = reset_scene()
    objects, removed = import_glb(os.path.join(job["_dir"], "scene.glb"))
    if removed:
        warn("ignored %d light/camera objects found in scene.glb" % removed)
    ctx["objects"] = objects

    stage("materials")
    ctx["materials"] = setup_materials(job, objects)

    stage("lights")
    ctx["lights"] = setup_lights(job, objects)

    stage("camera")
    apply_render_settings(scene, settings, getattr(opts, "threads", 0))
    ctx["camera"] = setup_camera(job, settings)
    errs = checkpoint_errors(job, settings, ctx["camera"])
    if errs:
        emit("check", checkpoints=len(errs), maxErrPx=round(max(errs), 4))
        if max(errs) > 1.0:
            warn("camera checkpoints reproject %.2f px off" % max(errs))

    stage("world")
    ctx["sky"] = setup_world(job, getattr(opts, "sky", "auto"))

    ctx["device"] = select_device(scene, getattr(opts, "device", "auto"))
    apply_color_management(scene, settings["view"], settings["look"])
    stops = exposure_stops(settings["ev100"], settings["ev_comp"])
    apply_exposure(scene, stops)
    set_backplate_defaults(ctx["materials"], stops)
    ctx["ev100"] = settings["ev100"]
    ctx["stops"] = stops
    return ctx


def run(opts):
    """Full pipeline (build, meter, render, save). Returns the result record."""
    job = load_job(opts.job)
    settings = resolve_settings(job, opts)
    ctx = build_scene(job, opts, settings)
    scene = bpy.context.scene

    if settings["auto_exposure"] and not opts.no_render:
        stage("meter")
        lavg = meter_scene(scene, settings)
        ev100 = ev100_from_luminance(lavg)
        stops = exposure_stops(ev100, settings["ev_comp"])
        apply_exposure(scene, stops)
        set_backplate_defaults(ctx["materials"], stops)
        ctx["ev100"], ctx["stops"] = ev100, stops
        emit("meter", lavgCd=round(lavg, 5), ev100=round(ev100, 3))

    os.makedirs(settings["out_dir"], exist_ok=True)
    png = os.path.join(settings["out_dir"], "render_pano.png" if settings["pano"] else "render.png")
    blend = os.path.join(settings["out_dir"], "scene.blend")
    t_render = time.time()
    if not opts.no_render:
        stage("render", w=settings["w"], h=settings["h"], samples=settings["samples"], device=ctx["device"],
              ev100=round(ctx["ev100"], 3), pano=settings["pano"])
        render_still(scene, png)
    else:
        png = None
    render_ms = int(round((time.time() - t_render) * 1000))
    scene.render.filepath = png or os.path.join(settings["out_dir"], "render.png")
    if settings["save_blend"]:
        stage("save")
        save_blend(blend)
    else:
        blend = None
    result = {"png": png, "blend": blend, "ms": int(round((time.time() - _T0) * 1000)), "renderMs": render_ms,
              "device": ctx["device"], "w": settings["w"],
              "h": settings["h"], "samples": settings["samples"], "ev100": round(ctx["ev100"], 3),
              "sky": ctx["sky"], "pano": settings["pano"]}
    emit("result", **result)
    return result


def main(argv=None):
    """CLI entry point; returns the process exit code."""
    global _T0
    _T0 = time.time()
    try:
        opts = parse_args(argv)
        run(opts)
        return 0
    except JobError as exc:
        emit("error", message=str(exc), trace="", code=2)
        return 2
    except Exception as exc:  # noqa: BLE001 - everything else is a python/render error
        emit("error", message="%s: %s" % (type(exc).__name__, exc), trace=traceback.format_exc(), code=1)
        return 1


def _exit(code):
    """Terminate with *code* reliably.

    Inside Blender a clean run returns normally (Blender then quits because of
    ``-b``); failures leave via ``os._exit`` so the exact code (2 for a bad job)
    survives whatever Blender does with a ``SystemExit`` raised from ``-P``.
    With pip ``bpy`` we always ``os._exit``: interpreter teardown can stall on
    Cycles/OIDN worker threads.
    """
    sys.stdout.flush()
    sys.stderr.flush()
    _flush_c_stdio()
    if IN_BLENDER_BINARY and code == 0:
        return
    os._exit(code)


if __name__ == "__main__":
    _exit(main())
