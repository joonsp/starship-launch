"""Headless QA renders of blender/<model>.blend -> blender/previews/*.png (Cycles CPU, works without a GPU)

Run:  ./blender/run.sh blender/render_previews.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "blender", "previews")
os.makedirs(OUT, exist_ok=True)

import glob
_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
_blend = next((a for a in _args if a.endswith(".blend")), None)
if not _blend:  # newest .blend in blender/
    _blend = max(glob.glob(os.path.join(ROOT, "blender", "*.blend")), key=os.path.getmtime)
bpy.ops.wm.open_mainfile(filepath=_blend)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"

world = bpy.data.worlds.new("w")
if not world.node_tree:  # Blender < 5 needs use_nodes; 5.x worlds always have nodes
    world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.57, 0.6, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world


def light(name, loc, energy, size=1.0):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    scene.collection.objects.link(ob)
    d = Vector((0.1, 0, 0)) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


# frame the whole scene automatically (Blender space: metres, Z up, viewer side = -Y)
_pts = [o.matrix_world @ Vector(c) for o in scene.objects if o.type == "MESH" for c in o.bound_box]
CENTER = sum(_pts, Vector()) / len(_pts)
SIZE = max((max(p[i] for p in _pts) - min(p[i] for p in _pts)) for i in range(3))


def light(name, loc, energy, size=1.0):  # noqa: F811 (re-defined with auto target)
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy * SIZE ** 2
    ld.size = size * SIZE
    ob = bpy.data.objects.new(name, ld)
    ob.location = CENTER + Vector(loc) * SIZE
    scene.collection.objects.link(ob)
    ob.rotation_euler = (CENTER - ob.location).to_track_quat("-Z", "Y").to_euler()
    return ob


light("key", (0.2, -1.2, 1.0), 400, 1.5)
light("fill", (-0.6, 1.0, 0.4), 150, 2.0)
light("rim", (0.0, 0.3, 1.5), 150, 2.0)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def set_view(mode):
    for ob in scene.objects:
        if ob.type != "MESH":
            continue
        is_cut = ob.name.endswith("__cut")
        has_cut = (ob.name + "__cut") in scene.objects
        if mode == "full":
            ob.hide_render = is_cut
        else:
            ob.hide_render = has_cut


def shoot(name, loc, target, ortho=None, lens=50, res=(1800, 700)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    else:
        cam_data.type = "PERSP"
        cam_data.lens = lens
    scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("[preview]", scene.render.filepath)


only = [a for a in _args if not a.endswith(".blend")]
C, K = CENTER, SIZE
# name -> (mode, camera location, target, ortho scale or None, lens, resolution); all relative to the scene bounds
shots = {
    "side_full": ("full", (C.x, C.y - 2 * K, C.z), tuple(C), 1.1 * K, None, (1800, 1000)),
    "side_cut": ("cut", (C.x, C.y - 2 * K, C.z), tuple(C), 1.1 * K, None, (1800, 1000)),
    "three_quarter": ("full", (C.x + 0.6 * K, C.y - 1.1 * K, C.z + 0.5 * K), tuple(C), None, 45, (1600, 1000)),
}
for key, (mode, loc, tgt, ortho, lens, res) in shots.items():
    if only and key not in only:
        continue
    set_view(mode)
    shoot(key, loc, tgt, ortho=ortho, lens=lens or 50, res=res)
