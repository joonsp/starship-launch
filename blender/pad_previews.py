"""QA renders of the pad model -> blender/previews/pad_*.png (Cycles CPU).

Run:  bash blender/run.sh blender/pad_previews.py [-- name ...]   (needs out/pad/pad.blend from build_pad.py)
Shows the role materials of the export (colours only matter here; three.js replaces them with the procedural ones).
Frame: three.js frame converted with T(x, y, z) = (x, -z, y).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "previews")
os.makedirs(OUT, exist_ok=True)
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "out", "pad", "pad.blend"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 20
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"


def T(x, y, z):
    return Vector((x, -z, y))


# sunrise sun from the ESE (az 95 deg, alt 12 deg for a readable preview) + sky
world = bpy.data.worlds.new("w")
if not world.node_tree:
    world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.5, 0.75, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
sc.world = world
sun_ld = bpy.data.lights.new("sun", "SUN")
sun_ld.energy = 4.0
sun_ld.color = (1.0, 0.82, 0.62)
sun_ld.angle = math.radians(1.5)
sun = bpy.data.objects.new("sun", sun_ld)
sc.collection.objects.link(sun)
az, alt = math.radians(95.0), math.radians(14.0)
d = T(math.sin(az) * math.cos(alt), math.sin(alt), -math.cos(az) * math.cos(alt))   # toward the sun
sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()                       # a sun lamp shines along its -Z

# ground: four slabs round the env module's trench cutout (80 x 32 m) so the trench is visible
m = bpy.data.materials.new("ground")
m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.04, 0.035, 1)
m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
for (x0, x1, z0, z1) in ((-3000, 3000, -3000, -16), (-3000, 3000, 16, 3000), (-3000, -40, -16, 16), (40, 3000, -16, 16)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=T((x0 + x1) / 2, -0.05, (z0 + z1) / 2))
    g = bpy.context.object
    g.scale = ((x1 - x0), (z1 - z0), 1)
    g.data.materials.append(m)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam


def shoot(name, loc, target, lens=35, res=(1600, 900)):
    if args and name not in args:
        return
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.location = T(*loc)
    cam.rotation_euler = (T(*target) - T(*loc)).to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = lens
    cam_data.clip_end = 5000
    sc.render.filepath = os.path.join(OUT, f"pad_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("[preview]", sc.render.filepath)


shoot("overview", (-140, 90, 170), (10, 30, -20), 32)
shoot("mount", (48, 22, 52), (0, 12, 0), 30)
shoot("tower_top", (26, 128, 40), (-3, 122, -20), 38)
shoot("trench", (46, 6, 22), (0, -4, 0), 26)
shoot("tank_farm", (150, 22, 60), (250, 4, -50), 40)
shoot("tower_base", (16, 12, 6), (-6, 18, -28), 30)
