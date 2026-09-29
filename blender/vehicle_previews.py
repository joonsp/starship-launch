"""QA renders of the vehicle model -> blender/previews/vehicle_*.png (Cycles CPU).

Run:  bash blender/run.sh blender/vehicle_previews.py [-- name ...]   (needs out/vehicle/vehicle.blend from build_vehicle.py)
Preview-only materials replace the exported role materials: frost/steel gradient on the booster, black
tiled belly on the ship, so the silhouette and part layout can be compared with the photo.
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

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "out", "vehicle", "vehicle.blend"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 40
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"


def T(x, y, z):
    return Vector((x, -z, y))


def node_mat(name, build):
    m = bpy.data.materials.get(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    build(nt, bsdf)


def gradient_by(nt, axis, thresh, a, b, soft=0.5):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = thresh - soft
    ramp.inputs["From Max"].default_value = thresh + soft
    nt.links.new(sep.outputs[axis], ramp.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = a
    mix.inputs[7].default_value = b
    nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
    return mix.outputs[2]


def booster(nt, b):
    col = gradient_by(nt, "Z", 44.5, (0.75, 0.78, 0.82, 1), (0.10, 0.11, 0.13, 1))
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Metallic"].default_value = 0.4


def ship(nt, b):
    # belly is Blender +Y: black there, brushed steel elsewhere
    col = gradient_by(nt, "Y", 0.0, (0.55, 0.56, 0.6, 1), (0.01, 0.01, 0.012, 1), soft=1.0)
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.35
    b.inputs["Metallic"].default_value = 0.6


def flat(color, rough=0.5, metal=0.5):
    def f(nt, b):
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
    return f


node_mat("steel_booster", booster)
node_mat("steel_ship", ship)
node_mat("booster_dark", flat((0.03, 0.03, 0.035, 1)))
node_mat("ship_dark", flat((0.03, 0.03, 0.035, 1)))
node_mat("flap", flat((0.015, 0.015, 0.02, 1), 0.3, 0.2))
node_mat("engine_bell", flat((0.16, 0.12, 0.09, 1), 0.35, 0.9))
node_mat("engine_steel", flat((0.45, 0.45, 0.47, 1), 0.35, 1.0))
node_mat("engine_dark", flat((0.04, 0.04, 0.045, 1), 0.5, 0.8))

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.6, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
sc.world = world

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 4.0
sun.color = (1.0, 0.8, 0.6)
sun.angle = math.radians(2)
so = bpy.data.objects.new("sun", sun)
sc.collection.objects.link(so)
# sun from the east, low: direction toward the sun in three frame = (cos(5.7)*sin(95.2), sin(5.7), -cos(95.2)cos(5.7)) — used in the vehicle frame
# for previews the sun is placed to light the belly (-z) obliquely from the +x side so both tiles and frost read
d = T(0.7, 0.35, -0.6).normalized()
so.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()

cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam


fill = bpy.data.lights.new("fill", "POINT")
fill.color = (1.0, 0.85, 0.7)
fill_ob = bpy.data.objects.new("fill", fill)
sc.collection.objects.link(fill_ob)


def shoot(name, loc, target, ortho=None, lens=35, res=(1400, 900), fill_w=0.0):
    if args and name not in args:
        return
    fill.energy = fill_w
    fill_ob.location = T(*loc) + (T(*target) - T(*loc)).normalized() * -0.5
    sc.render.resolution_x, sc.render.resolution_y = res
    cam.location = T(*loc)
    cam.rotation_euler = (T(*target) - T(*loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam_d.type = "ORTHO"
        cam_d.ortho_scale = ortho
    else:
        cam_d.type = "PERSP"
        cam_d.lens = lens
    sc.render.filepath = os.path.join(OUT, f"vehicle_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("[preview]", sc.render.filepath, flush=True)


shoot("belly_full", (0, 62, -600), (0, 62, 0), ortho=132, res=(520, 1000))
shoot("side_full", (600, 62, 0), (0, 62, 0), ortho=132, res=(520, 1000))
shoot("top_stack", (28, 92, -40), (0, 72, 0), lens=40)
shoot("engines_below", (14, -14, -20), (0, 1.0, 0), lens=30, fill_w=6000)
shoot("aft_skirt", (18, 6, -22), (0, 4, 0), lens=32, fill_w=3000)
shoot("hotstage", (16, 74, -22), (0, 68, 0), lens=32, fill_w=800)
shoot("gridfin", (12, 64, -8), (0, 62.5, 4.5), lens=40)
shoot("flap_aft", (14, 90, -30), (2, 80, 0), lens=45)
shoot("nose", (14, 118, -22), (0, 116, 0), lens=40)
shoot("engine_close", (2.2, -2.6, -3.2), (0.0, 0.8, 0), lens=45, res=(900, 1000), fill_w=250)
shoot("rvac_close", (5.0, 68.0, -8.0), (0.0, 73.0, 0), lens=40, fill_w=800)
