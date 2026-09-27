"""Tests for blender/render_venue.py (pip bpy 4.5).  Run: python -m pytest blender/tests -q"""

import json
import math
import os
import shutil
import struct
import sys

import bpy
import numpy as np
import pytest
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image

import render_venue as rv
from conftest import load_json, run_script
from make_fixture import three_equirect_uv

CD = 683.0


# ----------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------

def build(job_dir, *extra):
    opts = rv.parse_args(["--job", job_dir, "--no-blend"] + list(extra))
    job = rv.load_job(job_dir)
    ctx = rv.build_scene(job, opts)
    return job, ctx


def surface_node(mat):
    out = rv.output_node(mat.node_tree)
    return out.inputs["Surface"].links[0].from_node


def srgb_to_linear(v):
    v = np.asarray(v, dtype=np.float64)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def load_png_linear(path):
    """16-bit PNG written with the Standard view -> linear RGB (H, W, 3), top row first."""
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return srgb_to_linear(buf.reshape(h, w, 4)[::-1, :, :3])


def bright_centroid(path):
    """Centroid (x, y from the top-left corner, pixel centres at +0.5) of the brightest pixels."""
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64).sum(axis=2)
    lift = a - np.median(a)
    assert lift.max() > 100, "no hot spot found"
    ys, xs = np.nonzero(lift >= lift.max() * 0.5)
    wts = lift[ys, xs]
    assert len(xs) < a.size * 0.05, "hot spot is not compact"
    return float(np.sum((xs + 0.5) * wts) / wts.sum()), float(np.sum((ys + 0.5) * wts) / wts.sum()), a


def calib_scene(ev100, samples=32):
    """8x8 orthographic view straight down onto a white Lambert plane (albedo 1), black world."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    rv.apply_render_settings(sc, {"samples": samples, "noise_threshold": 0.0, "denoise": False,
                                  "max_bounces": 0, "w": 8, "h": 8})
    sc.cycles.use_adaptive_sampling = False
    sc.render.dither_intensity = 0.0
    rv.apply_color_management(sc, "Standard", "None")
    rv.apply_exposure(sc, rv.exposure_stops(ev100, 0.0))
    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    sc.world = world
    bpy.ops.mesh.primitive_plane_add(size=0.5)
    plane = bpy.context.object
    mat = bpy.data.materials.new("lambert")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    d.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    d.inputs["Roughness"].default_value = 0.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(d.outputs[0], o.inputs[0])
    plane.data.materials.append(mat)
    cd = bpy.data.cameras.new("cal")
    cd.type = "ORTHO"
    cd.ortho_scale = 0.05
    cam = bpy.data.objects.new("cal", cd)
    sc.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 1.0)
    sc.camera = cam
    return sc, plane


def render_mean(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return float(load_png_linear(path)[..., 0].mean())


def write_exr_top_first(path, rows):
    """Minimal uncompressed scanline OpenEXR writer (FLOAT B,G,R); rows[0] is the TOP scanline."""
    h, w = len(rows), len(rows[0])

    def attr(name, typ, data):
        return name.encode() + b"\0" + typ.encode() + b"\0" + struct.pack("<i", len(data)) + data

    chlist = b"".join(c.encode() + b"\0" + struct.pack("<iB3xii", 2, 0, 1, 1) for c in "BGR") + b"\0"
    box = struct.pack("<iiii", 0, 0, w - 1, h - 1)
    hdr = struct.pack("<ii", 20000630, 2)
    hdr += attr("channels", "chlist", chlist) + attr("compression", "compression", b"\0")
    hdr += attr("dataWindow", "box2i", box) + attr("displayWindow", "box2i", box)
    hdr += attr("lineOrder", "lineOrder", b"\0") + attr("pixelAspectRatio", "float", struct.pack("<f", 1.0))
    hdr += attr("screenWindowCenter", "v2f", struct.pack("<ff", 0.0, 0.0))
    hdr += attr("screenWindowWidth", "float", struct.pack("<f", 1.0)) + b"\0"
    chunks, offsets, pos = [], [], len(hdr) + 8 * h
    for y, row in enumerate(rows):
        data = b"".join(struct.pack("<%df" % w, *[px[ci] for px in row]) for ci in (2, 1, 0))
        chunk = struct.pack("<ii", y, len(data)) + data
        offsets.append(pos)
        pos += len(chunk)
        chunks.append(chunk)
    with open(path, "wb") as fh:
        fh.write(hdr + struct.pack("<%dQ" % h, *offsets) + b"".join(chunks))


# ----------------------------------------------------------------------------------------
# pure helpers
# ----------------------------------------------------------------------------------------

def test_frame_conversion_and_camera_axes():
    assert tuple(rv.to_blender((1.0, 2.0, 3.0))) == (1.0, -3.0, 2.0)
    m = rv.camera_matrix_from_three((0, 1.5, 0), (0, 0, 0, 1))      # identity: three camera looks down -Z
    fwd = m.to_3x3() @ Vector((0, 0, -1))
    up = m.to_3x3() @ Vector((0, 1, 0))
    assert (fwd - rv.to_blender((0, 0, -1))).length < 1e-9          # three -Z == Blender +Y
    assert (up - Vector((0, 0, 1))).length < 1e-9
    assert (m.translation - Vector((0, 0, 1.5))).length < 1e-9


def test_spot_blend_matches_three_penumbra():
    half = math.radians(18)
    assert rv.spot_blend_from_penumbra(half, 0.0) == 0.0
    assert abs(rv.spot_blend_from_penumbra(half, 1.0) - 1.0) < 1e-9
    b = rv.spot_blend_from_penumbra(half, 0.4)
    # Cycles' ramp end (cos space) must land on three's inner cone cos(half * (1 - penumbra))
    c_out = math.cos(half)
    assert abs(c_out + (1 - c_out) * b - math.cos(half * 0.6)) < 1e-12


def test_script_argv(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["Blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P",
                                      "blender/render_venue.py", "--", "--job", "D", "--res", "8x8"])
    assert rv.script_argv() == ["--job", "D", "--res", "8x8"]
    monkeypatch.setattr(sys, "argv", ["blender/render_venue.py", "--job", "D"])
    assert rv.script_argv() == ["--job", "D"]
    monkeypatch.setattr(rv, "IN_BLENDER_BINARY", True)
    monkeypatch.setattr(sys, "argv", ["Blender", "-b", "-P", "blender/render_venue.py"])
    assert rv.script_argv() == []


def test_resolve_settings(full_job_src):
    job = rv.load_job(full_job_src)

    def s(*extra):
        st = rv.resolve_settings(job, rv.parse_args(["--job", full_job_src] + list(extra)))
        return st["w"], st["h"], st["samples"]

    assert s() == (160, 90, 16)
    assert s("--preset", "final", "--res", "1920x1080") == (1920, 1080, 1024)
    assert s("--preset", "draft", "--samples", "7") == (160, 90, 7)
    assert s("--pano")[:2] == (180, 90)             # 2:1, same vertical pixel count as the still
    assert s("--pano", "--res", "128x64")[:2] == (128, 64)
    with pytest.raises(rv.JobError):
        s("--res", "big")


def test_exposure_formula():
    assert abs(rv.exposure_stops(6.3, 0.75) - (math.log2(683 / 1.2) - 6.3 + 0.75)) < 1e-12
    assert abs(rv.ev100_from_luminance(12.5 / 100 * 2 ** 7) - 7.0) < 1e-12


# ----------------------------------------------------------------------------------------
# (1) camera: checkpoints reproject exactly
# ----------------------------------------------------------------------------------------

def test_checkpoint_reprojection(full_job_src):
    job, ctx = build(full_job_src)
    sc = bpy.context.scene
    cam = sc.camera
    assert cam.name == "WP_Camera" and cam.data.sensor_fit == "VERTICAL"
    assert abs(math.degrees(cam.data.angle_y) - job["camera"]["fovYDeg"]) < 1e-4
    w, h = sc.render.resolution_x, sc.render.resolution_y
    assert (w, h) == (job["render"]["w"], job["render"]["h"])
    cps = job["checkpoints"]
    assert len(cps) >= 5
    worst = 0.0
    for cp in cps:
        co = world_to_camera_view(sc, cam, rv.to_blender(cp["world"]))
        px = (co.x * w, (1.0 - co.y) * h)
        err = math.hypot(px[0] - cp["px"][0], px[1] - cp["px"][1])
        worst = max(worst, err)
    assert worst < 0.5, worst
    # --res with the same aspect rescales the expected pixels
    job, ctx = build(full_job_src, "--res", "320x180")
    errs = rv.checkpoint_errors(job, ctx["settings"])
    assert errs and max(errs) < 0.5


# ----------------------------------------------------------------------------------------
# (3) sun/moon/lights
# ----------------------------------------------------------------------------------------

def test_sun_moon_and_lights(full_job_src):
    job, ctx = build(full_job_src)
    sun = bpy.data.objects["WP_Sun"]
    z = (sun.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    assert z.dot(rv.to_blender(job["sun"]["dir"]).normalized()) > 0.9999      # lamp shines along -sun.dir
    assert abs(sun.data.energy - job["sun"]["illuminanceLux"] / CD) < 1e-6
    assert abs(math.degrees(sun.data.angle) - 0.545) < 1e-4
    moon = bpy.data.objects["WP_Moon"]
    zm = (moon.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    assert zm.dot(rv.to_blender(job["moon"]["dir"]).normalized()) > 0.9999
    assert abs(moon.data.energy - 0.03 / CD) < 1e-9

    spot = bpy.data.objects["WP_Light_spot1"]
    lt = job["lights"][0]
    shine = (spot.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
    assert shine.dot(rv.to_blender(lt["direction"]).normalized()) > 0.9999
    assert (spot.matrix_world.translation - rv.to_blender(lt["position"])).length < 1e-6
    assert abs(spot.data.energy - 1200 * 4 * math.pi / CD) < 1e-6
    assert abs(math.degrees(spot.data.spot_size) - 36.0) < 1e-4
    assert abs(spot.data.shadow_soft_size - 0.02) < 1e-9

    lights = sorted(o.name for o in bpy.data.objects if o.type == "LIGHT")
    # the 'sun' directional duplicate and the ambient light are skipped; glb's stray light removed
    assert lights == ["WP_Light_flame_f1", "WP_Light_spot1", "WP_Moon", "WP_Sun"]
    assert [o.name for o in bpy.data.objects if o.type == "CAMERA"] == ["WP_Camera"]


# ----------------------------------------------------------------------------------------
# (5) material role upgrades
# ----------------------------------------------------------------------------------------

def test_role_upgrades(full_job_src):
    job, ctx = build(full_job_src)
    mats = bpy.data.materials

    glass = surface_node(mats["glass-clear__pane"])
    assert glass.bl_idname == "ShaderNodeGroup" and glass.node_tree.name == "WP_ThinGlass"
    assert abs(glass.inputs["IOR"].default_value - 1.5) < 1e-6

    def translucent_mix(mat):
        node = surface_node(mat)
        if node.name == "WP Alpha Mix":
            node = node.inputs[2].links[0].from_node
        assert node.bl_idname == "ShaderNodeMixShader"
        assert node.inputs[2].links[0].from_node.bl_idname == "ShaderNodeBsdfTranslucent"
        assert node.inputs[1].links[0].from_node.bl_idname == "ShaderNodeBsdfPrincipled"
        return node

    leaf = mats["foliage__leaf"]
    assert abs(translucent_mix(leaf).inputs["Fac"].default_value - 0.35) < 1e-6   # from glTF extras
    assert rv.principled_node(leaf.node_tree).inputs["Emission Strength"].default_value == 0.0

    linen = mats["linen__cloth1"]
    assert abs(translucent_mix(linen).inputs["Fac"].default_value - 0.15) < 1e-6
    b = rv.principled_node(linen.node_tree)
    assert abs(b.inputs["Sheen Weight"].default_value - 0.6) < 1e-6
    assert abs(b.inputs["Sheen Roughness"].default_value - 0.65) < 1e-6
    assert abs(b.inputs["Roughness"].default_value - 0.85) < 1e-6
    # COLOR_0 reaches Base Color through a colour-attribute node
    assert b.inputs["Base Color"].is_linked
    assert rv.uses_color_attribute(linen.node_tree)

    flame = mats["emitter-flame__f1"]
    fb = rv.principled_node(flame.node_tree)
    assert abs(fb.inputs["Emission Strength"].default_value - 1.0e4 / CD) < 1e-4
    assert tuple(fb.inputs["Emission Color"].default_value)[:3] == pytest.approx((1.0, 0.62, 0.28), abs=1e-3)
    fo = bpy.data.objects["flame_f1"]
    assert fo.visible_shadow is False
    assert fo.visible_diffuse is False            # paired with a lamp via shadowlessEmitter

    floor = rv.principled_node(mats["wood-floor__oak"].node_tree)
    assert abs(floor.inputs["Coat Weight"].default_value - 0.3) < 1e-6
    assert abs(floor.inputs["Coat Roughness"].default_value - 0.15) < 1e-6

    vase = rv.principled_node(mats["metal-stainless__vase"].node_tree)
    assert vase.inputs["Metallic"].default_value == 1.0
    assert abs(vase.inputs["Roughness"].default_value - 0.25) < 1e-6

    hills = bpy.data.objects["hills"]
    assert hills.visible_camera and not (hills.visible_diffuse or hills.visible_glossy or
                                         hills.visible_transmission or hills.visible_shadow)
    em = surface_node(mats["backplate__hills"])
    assert em.bl_idname == "ShaderNodeEmission"
    assert abs(em.inputs["Strength"].default_value - 0.8 / 2 ** ctx["stops"]) < 1e-6
    assert mats["backplate__hills"].cycles.emission_sampling == "NONE"

    # untouched roles keep imported values
    wall = rv.principled_node(mats["paint-wall__w1"].node_tree)
    assert abs(wall.inputs["Roughness"].default_value - 0.9) < 1e-6


def test_shadowless_emitter_matches_object_mesh_or_material():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = bpy.data.materials.new("emitter-flame__m")
    obs = []
    for name in ("emitter-flame__a", "other", "third"):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.01)
        ob = bpy.context.object
        ob.name = name
        obs.append(ob)
    obs[1].data.name = "emitter-flame__b"
    obs[2].data.materials.append(mat)
    assert rv._objects_for_emitter("emitter-flame__a", obs) == [obs[0]]
    assert rv._objects_for_emitter("emitter-flame__b.001", obs) == [obs[1]]
    assert rv._objects_for_emitter("emitter-flame__m", obs) == [obs[2]]


def test_vertex_color_wiring_when_importer_did_not():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_plane_add()
    ob = bpy.context.object
    ob.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    mat = bpy.data.materials.new("foliage__x")
    mat.use_nodes = True
    ob.data.materials.append(mat)
    b = rv.principled_node(mat.node_tree)
    b.inputs["Base Color"].default_value = (0.2, 0.5, 0.1, 1.0)
    assert not rv.uses_color_attribute(mat.node_tree)
    assert rv.wire_vertex_colors(mat, [ob.data])
    mix = b.inputs["Base Color"].links[0].from_node
    assert mix.bl_idname == "ShaderNodeMix" and mix.blend_type == "MULTIPLY"
    a_in = rv.find_socket(mix.inputs, "A_Color")
    assert a_in.links[0].from_node.bl_idname == "ShaderNodeVertexColor"
    assert a_in.links[0].from_node.layer_name == "Col"
    assert tuple(rv.find_socket(mix.inputs, "B_Color").default_value)[:3] == pytest.approx((0.2, 0.5, 0.1))
    assert not rv.wire_vertex_colors(mat, [ob.data])          # idempotent


# ----------------------------------------------------------------------------------------
# (4) photometric calibration
# ----------------------------------------------------------------------------------------

def test_photometric_sun(tmp_path):
    E, ev100 = 20000.0, 14.0
    sc, _ = calib_scene(ev100)
    coll = bpy.context.scene.collection
    rv.add_sun_lamp("cal_sun", (0.0, 1.0, 0.0), E / CD, (1, 1, 1), 0.545, coll)   # straight down
    expected = E / (CD * math.pi) * 2 ** rv.exposure_stops(ev100, 0.0)
    got = render_mean(sc, str(tmp_path / "sun.png"))
    assert abs(got / expected - 1.0) < 0.05, (got, expected)


@pytest.mark.parametrize("kind", ["point", "spot"])
def test_photometric_point_and_spot(tmp_path, kind):
    """I cd at d metres -> E = I/d^2 lux: validates P[W] = I * 4pi / 683."""
    intensity, d, ev100 = 1200.0, 2.0, 8.0
    sc, _ = calib_scene(ev100)
    light = {"id": "cal", "kind": kind, "position": [0.0, d, 0.0], "direction": [0.0, -1.0, 0.0],
             "intensityCd": intensity, "radiusM": 0.01, "halfAngleDeg": 30.0, "penumbra": 0.2}
    rv.setup_lights({"lights": [light]}, [])
    expected = intensity / d ** 2 / (CD * math.pi) * 2 ** rv.exposure_stops(ev100, 0.0)
    got = render_mean(sc, str(tmp_path / ("%s.png" % kind)))
    assert abs(got / expected - 1.0) < 0.05, (got, expected)


def test_photometric_emitter(tmp_path):
    """Emitter luminance L cd/m^2 -> film value L/683 * 2^exposure."""
    lum, ev100 = 5000.0, 14.0
    sc, plane = calib_scene(ev100)
    mat = bpy.data.materials.new("emitter-led__cal")
    mat.use_nodes = True
    rv.principled_node(mat.node_tree).inputs["Base Color"].default_value = (1, 1, 1, 1)
    rv.upgrade_material(mat, {"role": "emitter-led", "luminance": lum}, [])
    plane.data.materials[0] = mat
    expected = lum / CD * 2 ** rv.exposure_stops(ev100, 0.0)
    got = render_mean(sc, str(tmp_path / "em.png"))
    assert abs(got / expected - 1.0) < 0.05, (got, expected)


def test_thin_glass_transmission(tmp_path):
    """A clear pane in front of an emitter passes (1 - R_slab) = 1 - 2R0/(1+R0) at normal incidence."""
    sc, plane = calib_scene(14.0, samples=16)
    mat = bpy.data.materials.new("emitter-led__bg")
    mat.use_nodes = True
    rv.principled_node(mat.node_tree).inputs["Base Color"].default_value = (1, 1, 1, 1)
    rv.upgrade_material(mat, {"role": "emitter-led", "luminance": 5000.0}, [])
    plane.data.materials[0] = mat
    bpy.ops.mesh.primitive_plane_add(size=0.5, location=(0, 0, 0.5))
    pane = bpy.context.object
    gm = bpy.data.materials.new("glass-clear__cal")
    gm.use_nodes = True
    rv.principled_node(gm.node_tree).inputs["Base Color"].default_value = (1, 1, 1, 1)   # untinted
    rv.upgrade_material(gm, {"role": "glass-clear"}, [])
    pane.data.materials.append(gm)
    sc.cycles.max_bounces = 8
    through = render_mean(sc, str(tmp_path / "through.png"))
    pane.hide_render = True
    direct = render_mean(sc, str(tmp_path / "direct.png"))
    r0 = 0.04
    assert through / direct == pytest.approx(1 - 2 * r0 / (1 + r0), abs=0.01)


# ----------------------------------------------------------------------------------------
# (2) sky orientation: hot texel
# ----------------------------------------------------------------------------------------

def test_exr_top_scanline_is_zenith(tmp_path):
    """A spec-conforming EXR (first scanline = zenith) loads with the zenith as Blender's top row."""
    w, h = 16, 8
    rows = [[(5.0, 5.0, 5.0)] * w] + [[(0.1, 0.2, 0.3)] * w for _ in range(h - 1)]
    path = str(tmp_path / "top.exr")
    write_exr_top_first(path, rows)
    img = bpy.data.images.load(path)
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(h, w, 4)
    assert np.allclose(px[h - 1, :, :3], 5.0)       # Blender row h-1 is the top of the image (v = 1)
    assert np.allclose(px[0, :, :3], (0.1, 0.2, 0.3))


def _sky_copy(src, tmp_path):
    dst = tmp_path / "sky"
    shutil.copytree(src, dst)
    return str(dst)


def test_sky_hot_texel_panorama(sky_job_src, tmp_path):
    job_dir = _sky_copy(sky_job_src, tmp_path)
    code, events, out, dt = run_script(["--job", job_dir, "--pano", "--res", "128x64", "--samples", "8",
                                        "--no-denoise", "--device", "cpu"])
    assert code == 0, out[-3000:]
    png = os.path.join(job_dir, "render_pano.png")
    cx, cy, a = bright_centroid(png)
    assert a.shape == (64, 128)
    hot = load_json(os.path.join(job_dir, "scene.json"))["hot"]
    u, v = three_equirect_uv(hot["centerDirThree"])
    ex, ey = u * 128, (1.0 - v) * 64
    assert math.hypot(cx - ex, cy - ey) < 1.5, ((cx, cy), (ex, ey))
    # sanity: a mirrored / rotated mapping would be far away
    assert math.hypot(cx - (128 - ex), cy - ey) > 10


def test_sky_hot_texel_perspective(sky_job_src, tmp_path):
    """The script's camera aimed (in three's frame) at the hot texel's direction sees it at the centre."""
    job_dir = _sky_copy(sky_job_src, tmp_path)
    code, events, out, dt = run_script(["--job", job_dir, "--no-pano", "--device", "cpu"])
    assert code == 0, out[-3000:]
    cx, cy, a = bright_centroid(os.path.join(job_dir, "render.png"))
    assert a.shape == (33, 33)
    assert math.hypot(cx - 16.5, cy - 16.5) < 1.5, (cx, cy)


def test_nishita_fallback_sun_position(full_job_src, tmp_path):
    job, ctx = build(full_job_src, "--sky", "nishita", "--pano", "--res", "128x64", "--samples", "16",
                     "--no-denoise", "--view", "Standard")
    assert ctx["sky"] == "nishita"
    sc = bpy.context.scene
    tex = sc.world.node_tree.nodes["WP Sky"]
    assert tex.sky_type == "NISHITA" and tex.sun_disc is False
    assert abs(tex.altitude - job["venue"]["elevM"]) < 1e-3
    # render the sky alone with the sun disc on: its brightest pixel must sit at sun.dir
    tex.sun_disc = True
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ob.hide_render = True
    rv.apply_exposure(sc, -8.0)
    sc.render.filepath = str(tmp_path / "nishita.png")
    bpy.ops.render.render(write_still=True)
    a = np.asarray(Image.open(str(tmp_path / "nishita.png")).convert("RGB"), dtype=np.float64).sum(axis=2)
    iy, ix = np.unravel_index(np.argmax(a), a.shape)
    u, v = three_equirect_uv(job["sun"]["dir"])
    assert abs((ix + 0.5) - u * 128) < 2.0 and abs((iy + 0.5) - (1 - v) * 64) < 2.0, ((ix, iy), (u * 128,
                                                                                            (1 - v) * 64))


# ----------------------------------------------------------------------------------------
# (6) end to end
# ----------------------------------------------------------------------------------------

def test_end_to_end(full_job):
    code, events, out, dt = run_script(["--job", full_job, "--res", "160x90", "--samples", "16"])
    assert code == 0, out[-4000:]
    assert dt < 90, dt
    stages = [e["stage"] for e in events if e["ev"] == "stage"]
    assert stages == ["import", "materials", "lights", "camera", "world", "render", "save"]
    assert any(e["ev"] == "progress" for e in events)
    check = [e for e in events if e["ev"] == "check"]
    assert check and check[0]["maxErrPx"] < 0.5
    result = [e for e in events if e["ev"] == "result"]
    assert len(result) == 1 and result[0]["device"] == "CPU"
    png, blend = result[0]["png"], result[0]["blend"]
    assert png == os.path.join(full_job, "render.png") and os.path.isfile(png)
    im = Image.open(png)
    assert im.size == (160, 90)
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    assert np.isfinite(a).all() and a.mean() > 10 and a.std() > 5
    # 16-bit RGB PNG
    with open(png, "rb") as fh:
        head = fh.read(33)
    assert head[24] == 16 and head[25] == 2

    assert blend and os.path.isfile(blend)
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    assert sc.camera and sc.camera.name == "WP_Camera"
    assert sc.render.engine == "CYCLES" and sc.cycles.use_light_tree and sc.cycles.use_adaptive_sampling
    assert sc.cycles.denoiser == "OPENIMAGEDENOISE"
    assert sc.cycles.film_exposure == pytest.approx(2 ** rv.exposure_stops(13.0, 0.5), rel=1e-5)
    assert sc.view_settings.view_transform == "AgX"
    env = sc.world.node_tree.nodes["WP Sky"]
    assert env.image is not None and env.image.packed_file is not None
    assert "WP_ThinGlass" in bpy.data.node_groups


def test_auto_exposure_meter(full_job):
    code, events, out, dt = run_script(["--job", full_job, "--res", "64x36", "--samples", "8", "--auto-exposure",
                                        "--no-denoise", "--no-blend", "--device", "cpu"])
    assert code == 0, out[-3000:]
    meter = [e for e in events if e["ev"] == "meter"]
    assert len(meter) == 1
    ev = meter[0]["ev100"]
    assert 9.0 < ev < 17.0, meter          # sunlit daylight scene
    assert abs(meter[0]["ev100"] - rv.ev100_from_luminance(meter[0]["lavgCd"])) < 1e-2
    result = [e for e in events if e["ev"] == "result"][0]
    assert result["ev100"] == pytest.approx(ev, abs=1e-3)
    assert result["blend"] is None and not os.path.exists(os.path.join(full_job, "scene.blend"))


def test_bad_jobs_exit_2(full_job, tmp_path):
    code, events, out, _ = run_script(["--job", str(tmp_path / "missing")])
    assert code == 2 and events[-1]["ev"] == "error"

    code, events, out, _ = run_script(["--job", full_job, "--bogus"])
    assert code == 2 and events[-1]["ev"] == "error"

    sj = os.path.join(full_job, "scene.json")
    job = load_json(sj)
    job["schema"] = "wp-scene/999"
    with open(sj, "w") as fh:
        json.dump(job, fh)
    code, events, out, _ = run_script(["--job", full_job])
    assert code == 2 and "schema" in events[-1]["message"]

    bad = tmp_path / "badglb"
    shutil.copytree(full_job, bad)
    job["schema"] = "wp-scene/1"
    with open(bad / "scene.json", "w") as fh:
        json.dump(job, fh)
    with open(bad / "scene.glb", "wb") as fh:
        fh.write(b"not a glb")
    code, events, out, _ = run_script(["--job", str(bad)])
    assert code == 2 and "glTF" in events[-1]["message"]
