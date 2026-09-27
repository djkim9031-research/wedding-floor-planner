#!/usr/bin/env python3
"""Build small wp-scene/1 job directories for the render_venue tests.

The scene is modelled in Blender (Z-up) and exported with Blender's glTF
exporter in its default Y-up mode, which reproduces what three.js'
GLTFExporter writes.  scene.json is written in three's frame (Y-up metres),
using the inverse of the contract's (x, y, z) -> (x, -z, y) map, and the
checkpoints' expected pixels are computed analytically from the intended
camera (no Blender camera involved).

Usage (fresh process recommended, it resets the bpy session)::

    python blender/tests/make_fixture.py --out DIR [--kind full|sky]
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# Blender (x, y, z) -> three (x, z, -y): inverse of three -> Blender (x, -z, y)
M_B2T = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0)))

# hot texel direction for the sky-orientation job (three frame, deliberately asymmetric)
HOT_DIR_THREE = (0.55, 0.42, -0.72)
SKY_W, SKY_H = 256, 128


def b2t(v):
    """Blender point/direction -> three frame list."""
    return list(M_B2T @ Vector(v))


def three_equirect_uv(d):
    """three's equirectUv(): u = atan2(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5 (v = 1 at the zenith)."""
    x, y, z = d
    n = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / n, y / n, z / n
    return math.atan2(z, x) / (2 * math.pi) + 0.5, math.asin(max(-1.0, min(1.0, y))) / math.pi + 0.5


def three_dir_from_uv(u, v):
    """Inverse of three_equirect_uv."""
    phi = (u - 0.5) * 2 * math.pi
    lat = (v - 0.5) * math.pi
    return (math.cos(lat) * math.cos(phi), math.sin(lat), math.cos(lat) * math.sin(phi))


def look_rotation_blender(eye, target, up=(0.0, 0.0, 1.0)):
    """Blender camera rotation (looks down local -Z, +Y up) from eye to target."""
    f = (Vector(target) - Vector(eye)).normalized()
    return f.to_track_quat("-Z", "Y").to_matrix()


def three_camera_from_blender(eye, rot_b):
    """(position, quaternion xyzw, rotation matrix) of the same camera in three's frame."""
    rot_t = M_B2T @ rot_b
    q = rot_t.to_quaternion()
    return b2t(eye), [q.x, q.y, q.z, q.w], rot_t


def project_three(p3, cam_pos3, rot_t, fov_y_deg, w, h):
    """Analytic pinhole projection (three conventions) -> pixel coords, origin top-left."""
    pc = rot_t.transposed() @ (Vector(p3) - Vector(cam_pos3))
    if pc.z >= 0:
        return None
    t = math.tan(math.radians(fov_y_deg) / 2.0)
    aspect = w / float(h)
    nx = (pc.x / -pc.z) / (t * aspect)
    ny = (pc.y / -pc.z) / t
    return [(nx + 1.0) * 0.5 * w, (1.0 - ny) * 0.5 * h]


# ----------------------------------------------------------------------------------------
# EXR writing via bpy
# ----------------------------------------------------------------------------------------

def write_sky_exr(path, fn, w=SKY_W, h=SKY_H):
    """Write an equirect float EXR; fn(dir_three) -> (r, g, b).  Top scanline = zenith."""
    img = bpy.data.images.new("wp_sky_fixture", w, h, float_buffer=True, alpha=False)
    px = [0.0] * (w * h * 4)
    for row in range(h):          # Blender rows start at the bottom
        v = (row + 0.5) / h
        for col in range(w):
            u = (col + 0.5) / w
            r, g, b = fn(three_dir_from_uv(u, v), col, h - 1 - row)
            i = (row * w + col) * 4
            px[i:i + 4] = (r, g, b, 1.0)
    img.pixels.foreach_set(px)
    img.filepath_raw = path
    img.file_format = "OPEN_EXR"
    img.save()
    bpy.data.images.remove(img)


def gradient_sky(d, col, row_from_top):
    y = d[1]
    if y >= 0:
        k = 2.0 + 2.5 * (1.0 - y) ** 3          # brighter horizon, W/m^2/sr (x683 cd/m^2)
        return (0.62 * k, 0.78 * k, 1.05 * k)
    return (0.30, 0.27, 0.24)                    # ground


def hot_texel(u_hot, v_hot, w=SKY_W, h=SKY_H):
    """Texel (col, row_from_top) holding a three-frame direction."""
    col = min(w - 1, int(u_hot * w))
    row_from_top = min(h - 1, int((1.0 - v_hot) * h))
    return col, row_from_top


# ----------------------------------------------------------------------------------------
# scene building
# ----------------------------------------------------------------------------------------

def principled_material(name, color, rough=0.5, metallic=0.0, pbr=None, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = tuple(color) + (1.0,)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emission:
        b.inputs["Emission Color"].default_value = tuple(color) + (1.0,)
        b.inputs["Emission Strength"].default_value = emission
    if pbr is not None:
        mat["pbr"] = pbr
    return mat


def add_mesh(op, name, mat, **kw):
    op(**kw)
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    ob.data.materials.append(mat)
    return ob


def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_lights=True, export_cameras=True, export_vertex_color="ACTIVE",
                              export_apply=True)


def build_full(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ops = bpy.ops.mesh
    add_mesh(ops.primitive_plane_add, "floor", principled_material("wood-floor__oak", (0.42, 0.28, 0.16), 0.45),
             size=8.0)
    add_mesh(ops.primitive_cube_add, "wall", principled_material("paint-wall__w1", (0.8, 0.78, 0.74), 0.9),
             size=1.0, location=(0.0, 3.0, 1.5), scale=(6.0, 0.1, 3.0))
    add_mesh(ops.primitive_cube_add, "table", principled_material("wood-table__t1", (0.35, 0.22, 0.12), 0.5),
             size=1.0, location=(0.0, 0.0, 0.37), scale=(1.0, 1.0, 0.74))
    # cloth: subdivided plane with a vertex colour attribute
    cloth = add_mesh(ops.primitive_grid_add, "cloth1",
                     principled_material("linen__cloth1", (0.92, 0.9, 0.86), 0.8,
                                         pbr={"role": "linen", "sheen": 0.6}),
                     x_subdivisions=8, y_subdivisions=8, size=1.3, location=(0.0, 0.0, 0.745))
    ca = cloth.data.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(cloth.data.vertices):
        t = (v.co.x + 0.65) / 1.3
        ca.data[i].color = (1.0, 0.75 + 0.25 * t, 0.7 + 0.3 * t, 1.0)
    cloth.data.color_attributes.active_color = ca
    # flame sphere (small emissive) with a point light inside it (from scene.json)
    add_mesh(ops.primitive_uv_sphere_add, "flame_f1",
             principled_material("emitter-flame__f1", (1.0, 0.62, 0.28), 0.5, emission=1.0),
             radius=0.02, segments=12, ring_count=8, location=(0.2, 0.1, 0.8))
    # thin single-surface glass pane (vertical, faces -Y)
    add_mesh(ops.primitive_plane_add, "glass-clear__pane",
             principled_material("glass-clear__pane", (0.96, 0.98, 1.0), 0.05),
             size=1.0, location=(1.2, 0.8, 0.9), rotation=(math.pi / 2, 0.0, 0.0))
    add_mesh(ops.primitive_plane_add, "leaf",
             principled_material("foliage__leaf", (0.18, 0.38, 0.12), 0.6,
                                 pbr={"role": "foliage", "translucency": 0.35}),
             size=0.5, location=(-1.2, 0.6, 0.9), rotation=(1.2, 0.2, 0.3))
    add_mesh(ops.primitive_cylinder_add, "vase",
             principled_material("metal-stainless__vase", (0.8, 0.8, 0.8), 0.5),
             radius=0.06, depth=0.2, vertices=16, location=(-0.25, -0.2, 0.84))
    add_mesh(ops.primitive_plane_add, "hills",
             principled_material("backplate__hills", (0.5, 0.6, 0.45), 1.0),
             size=1.0, location=(0.0, 6.0, 2.0), rotation=(math.pi / 2, 0.0, 0.0), scale=(10.0, 4.0, 1.0))
    # stray light + camera: the contract says the glb has none, the script must drop them
    bpy.ops.object.light_add(type="POINT", location=(0.0, 0.0, 3.0))
    bpy.context.object.name = "StrayLight"
    bpy.ops.object.camera_add(location=(0.0, -5.0, 1.0))
    bpy.context.object.name = "StrayCamera"
    export_glb(os.path.join(out, "scene.glb"))
    write_sky_exr(os.path.join(out, "sky.exr"), gradient_sky)

    w, h, fov = 160, 90, 50.0
    eye = (3.1, -3.4, 1.55)
    target = (0.0, 0.3, 0.7)
    rot_b = look_rotation_blender(eye, target)
    pos3, quat3, rot_t = three_camera_from_blender(eye, rot_b)
    cps = []
    for pb in [(0.5, 0.5, 0.745), (-0.5, -0.5, 0.745), (0.5, -0.5, 0.0), (0.2, 0.1, 0.8),
               (1.2, 0.8, 0.9), (-2.0, 2.9, 2.5), (1.7, -1.0, 0.0)]:
        p3 = b2t(pb)
        px = project_three(p3, pos3, rot_t, fov, w, h)
        if px and 0 <= px[0] <= w and 0 <= px[1] <= h:
            cps.append({"world": p3, "px": px})

    alt, az = math.radians(28.0), math.radians(215.0)   # Blender azimuth from +X, CCW
    sun_b = (math.cos(alt) * math.cos(az), math.cos(alt) * math.sin(az), math.sin(alt))
    moon_b = Vector((0.3, 0.5, 0.6)).normalized()
    job = {
        "schema": "wp-scene/1",
        "app": {"version": "test", "three": "0.186.1", "exportedAt": "2026-09-27T12:00:00Z"},
        "frame": {"source": "three-yup-meters", "blenderMap": "(x,y,z)->(x,-z,y)"},
        "venue": {"lat": 37.42, "lon": -122.2, "elevM": 119, "tz": "America/Los_Angeles", "facadeAzDeg": 50},
        "time": {"date": "2026-09-20", "minutes": 1020, "utc": "2026-09-21T00:00:00Z"},
        "sun": {"altitudeDeg": 28.0, "azimuthTrueDeg": 235.0, "dir": b2t(sun_b), "visible": True,
                "illuminanceLux": 30000.0, "colorLinear": [1.0, 0.93, 0.85], "angularDiameterDeg": 0.545},
        "moon": {"dir": b2t(moon_b), "fraction": 0.42, "illuminanceLux": 0.03, "colorLinear": [0.9, 0.92, 1.0]},
        "sky": {"file": "sky.exr", "units": "W/m2/sr", "cdPerUnit": 683, "convention": "three-equirect",
                "clouds": 0},
        "camera": {"type": "perspective", "position": pos3, "quaternion": quat3, "fovYDeg": fov,
                   "aspect": w / h, "near": 0.05, "far": 500.0,
                   "dof": {"enabled": False, "focusM": 4.2, "fStop": 2.8}},
        "exposure": {"ev100": 13.0, "evComp": 0.5, "view": "AgX", "look": "None", "auto": False},
        "render": {"w": w, "h": h, "samples": 16, "noiseThreshold": 0.05, "denoise": "OIDN", "maxBounces": 4,
                   "preset": "draft", "saveBlend": True, "panorama": False},
        "lights": [
            {"id": "spot1", "kind": "spot", "group": "interior", "position": b2t((0.0, 0.0, 2.6)),
             "direction": b2t((0.0, 0.0, -1.0)), "colorLinear": [1.0, 0.85, 0.7], "intensityCd": 1200.0,
             "halfAngleDeg": 18.0, "penumbra": 0.4, "radiusM": 0.02},
            {"id": "flame_f1", "kind": "point", "group": "decor", "position": b2t((0.2, 0.1, 0.8)),
             "colorLinear": [1.0, 0.6, 0.3], "intensityCd": 4.0, "radiusM": 0.01,
             "shadowlessEmitter": "emitter-flame__f1"},
            {"id": "sun", "kind": "directional", "direction": [-c for c in b2t(sun_b)], "illuminanceLux": 30000.0},
            {"id": "amb", "kind": "ambient", "intensity": 0.1},
        ],
        "materials": {"linen__cloth1": {"role": "linen", "sheen": 0.6, "sheenRoughness": 0.65},
                      "wood-floor__oak": {"role": "wood-floor"}},
        "objects": {},
        "checkpoints": cps,
        "stats": {},
    }
    with open(os.path.join(out, "scene.json"), "w") as fh:
        json.dump(job, fh, indent=1)
    return job


def build_sky(out):
    """Minimal job for the sky-orientation test: dim sky + one hot texel."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # a tiny object far below so the glb is not empty and cannot occlude the upper sky
    add_mesh(bpy.ops.mesh.primitive_cube_add, "probe", principled_material("generic__probe", (0.5, 0.5, 0.5)),
             size=0.1, location=(0.0, 0.0, -50.0))
    export_glb(os.path.join(out, "scene.glb"))
    u, v = three_equirect_uv(HOT_DIR_THREE)
    hc, hr = hot_texel(u, v)

    def sky(d, col, row_from_top):
        return (40.0, 40.0, 40.0) if (col == hc and row_from_top == hr) else (0.01, 0.01, 0.01)

    write_sky_exr(os.path.join(out, "sky.exr"), sky)
    # centre direction of the hot texel (what the camera should aim at)
    hot_center = three_dir_from_uv((hc + 0.5) / SKY_W, 1.0 - (hr + 0.5) / SKY_H)
    rot_b = look_rotation_blender((0, 0, 0), tuple(Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))) @ Vector(hot_center)))
    pos3, quat3, _ = three_camera_from_blender((0.0, 0.0, 0.0), rot_b)
    job = {
        "schema": "wp-scene/1",
        "frame": {"source": "three-yup-meters", "blenderMap": "(x,y,z)->(x,-z,y)"},
        "sun": {"dir": [0.0, -1.0, 0.0], "visible": False, "illuminanceLux": 0},
        "sky": {"file": "sky.exr", "units": "W/m2/sr", "cdPerUnit": 683, "convention": "three-equirect"},
        "camera": {"type": "perspective", "position": pos3, "quaternion": quat3, "fovYDeg": 20.0,
                   "aspect": 1.0, "near": 0.05, "far": 1000.0},
        "exposure": {"ev100": 8.0, "evComp": 0.0, "view": "Standard", "look": "None", "auto": False},
        "render": {"w": 33, "h": 33, "samples": 4, "noiseThreshold": 0.1, "denoise": "none", "maxBounces": 1,
                   "saveBlend": False, "panorama": False},
        "lights": [],
        "materials": {},
        "hot": {"dirThree": list(HOT_DIR_THREE), "texel": [hc, hr], "centerDirThree": list(hot_center),
                "skyW": SKY_W, "skyH": SKY_H},
    }
    with open(os.path.join(out, "scene.json"), "w") as fh:
        json.dump(job, fh, indent=1)
    return job


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--kind", choices=("full", "sky"), default="full")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    (build_full if a.kind == "full" else build_sky)(a.out)
    print("fixture written to", a.out)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
