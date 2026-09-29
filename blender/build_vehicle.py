"""Build the Starship V3 stack (Super Heavy B21 + Starship S41) headless and export public/models/starship.glb.

Run:  bash blender/run.sh blender/build_vehicle.py            (add  -- --no-export  to only save the .blend)

Frame (the three.js frame, see src/contracts.ts): metres, origin on the stack axis at the booster aft-skirt
bottom (the engine plane), y up, the ship's tiled belly faces -z. Every hull part is exported with an
identity transform in vehicle coordinates so the shaders can use object-space position as vehicle-frame
position. Engines are linked duplicates of one mesh (shared geometry, small GLB).

Object names (used by src/vehicle/index.ts to assign materials and hotspots):
  booster_hull booster_skirt booster_dome booster_engine_bay hotstage booster_details
  booster_raceway_0/1 catch_pin_0/1 gridfin_0/1/2
  booster_engines/raptor_NN/{raptor_NN_hi, raptor_NN_lo}   (NN 00..32, order = src/core/engine-layout.ts)
  ship_skirt ship_hull ship_nose ship_engine_bay ship_details ship_raceway_0/1
  flap_fwd_L flap_fwd_R flap_aft_L flap_aft_R
  ship_engines/{raptor_rvac_i, raptor_rsl_i}/{..._hi, ..._lo}
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import vehicle_booster as vb  # noqa: E402
import vehicle_engine as ve  # noqa: E402
import vehicle_geo as vg  # noqa: E402
import vehicle_ship as vs  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = os.path.join(ROOT, "public", "models", "starship.glb")
OUT_BLEND = os.path.join(ROOT, "out", "vehicle", "vehicle.blend")

with open(os.path.join(ROOT, "specs", "starship.json"), encoding="utf-8") as f:
    SPEC = {k: v["v"] for k, v in json.load(f)["values"].items()}


def val(k):
    return SPEC[k]


BOOSTER_LEN = val("vehicle.booster.length")
vs.SH0 = BOOSTER_LEN
FIN_Y = 66.8                       # photo-measured fin height (spec estimate: 62.5)
FIN_AZ_OFFSET = 30.0               # photo-measured fin clocking (spec estimate: 0/120/240)
NOZZLE_BELOW_PLANE = 0.6           # src/core/engine-layout.ts NOZZLE_EXIT_BELOW_PLANE

t0 = time.time()


def lap(msg):
    print(f"[vehicle] {time.time() - t0:6.1f}s {msg}", flush=True)


# ------------------------------------------------------------------------------ engine layout (port of engine-layout.ts)

def booster_engines():
    out = []

    def slot(ring, r, ang):
        a = math.radians(ang)
        out.append(dict(ring=ring, x=r * math.cos(a), z=-r * math.sin(a), ang=ang))

    rc = val("vehicle.booster.engine_ring_centre.radius")
    clock = val("vehicle.booster.engine_ring_centre.clocking")
    a = 90.0
    for i in range(3):
        slot("centre", rc, a)
        a += clock[i] if i < len(clock) else 120
    rm = val("vehicle.booster.engine_ring_mid.radius")
    off = val("vehicle.booster.engine_ring_mid.clock_offset")
    for i in range(10):
        slot("mid", rm, off + i * 36)
    ro = val("vehicle.booster.engine_ring_outer.radius")
    for i in range(20):
        slot("outer", ro, i * 18)
    return out


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0

    # material roles (names are the contract with three.js); colours only matter for the Blender previews
    for name, rgba, met, rough in [
        ("steel_booster", (0.55, 0.56, 0.58, 1), 1.0, 0.4), ("booster_dark", (0.05, 0.05, 0.06, 1), 0.9, 0.5),
        ("steel_ship", (0.6, 0.6, 0.62, 1), 1.0, 0.35), ("ship_dark", (0.05, 0.05, 0.06, 1), 0.9, 0.5),
        ("flap", (0.02, 0.02, 0.025, 1), 0.2, 0.4),
        ("engine_bell", (0.12, 0.10, 0.09, 1), 0.9, 0.4), ("engine_steel", (0.4, 0.4, 0.42, 1), 1.0, 0.35),
        ("engine_dark", (0.03, 0.03, 0.035, 1), 0.8, 0.5),
    ]:
        vg.get_material(name, rgba, met, rough)

    stats = {}

    def add(geo, name, parent=None):
        ob = vg.to_object(geo, name, parent=parent)
        stats[name] = geo.tri_count()
        return ob

    # ---------------- booster
    add(vb.build_hull(), "booster_hull")
    add(vb.build_skirt(), "booster_skirt")
    add(vb.build_dome(), "booster_dome")
    add(vb.build_engine_bay(), "booster_engine_bay")
    add(vb.build_hotstage(), "hotstage")
    add(vb.build_details(), "booster_details")
    lap("booster hull parts")
    # The photo (research/reference.jpeg) shows the fins as thin horizontal dashes at ~66.8 m, sticking out on BOTH
    # silhouette sides of the camera-facing view: fins at azimuth 30/150/270, not the estimated 0/120/240, and
    # higher than the estimated 62.5 m hinge height. Photo evidence wins; see the module report.
    y_hinge = FIN_Y
    span = val("vehicle.booster.grid_fin.span")
    for i, az in enumerate(val("vehicle.booster.grid_fin.azimuth_deg")):
        add(vb.build_gridfin(az + FIN_AZ_OFFSET, y_hinge, span), f"gridfin_{i}")
    for i, az in enumerate((75.0, 255.0)):
        add(vb.build_catch_pin(az, val("vehicle.booster.catch_pin_height")), f"catch_pin_{i}")
    for i, az in enumerate((60.0, 300.0)):
        add(vb.build_raceway(az), f"booster_raceway_{i}")
    lap("fins, pins, raceways")

    # ---------------- ship
    add(vs.build_skirt(), "ship_skirt")
    add(vs.build_hull(), "ship_hull")
    add(vs.build_nose(), "ship_nose")
    add(vs.build_engine_bay(), "ship_engine_bay")
    add(vs.build_details(), "ship_details")
    add(vs.build_raceway(230.0), "ship_raceway_0")
    add(vs.build_raceway(310.0), "ship_raceway_1")
    add(vs.build_aft_flap(+1), "flap_aft_L")
    add(vs.build_aft_flap(-1), "flap_aft_R")
    add(vs.build_fwd_flap(+1), "flap_fwd_L")
    add(vs.build_fwd_flap(-1), "flap_fwd_R")
    lap("ship parts")

    # ---------------- engines: one mesh per (kind, lod), linked duplicates at every slot
    meshes = {}
    for kind in ("sl_fixed", "sl_gimbal", "rvac"):
        for lod in (0, 1):
            g, info = ve.build_engine(kind, lod)
            meshes[(kind, lod)] = vg.to_mesh(g, f"mesh_{kind}_{'hi' if lod == 0 else 'lo'}")
            stats[f"engine_{kind}_lod{lod}"] = g.tri_count()
    lap("engine meshes")

    def place(name, kind, x, y, z, ang, parent):
        e = vg.empty(name, (x, y, z), parent)
        e.rotation_euler = (0.0, 0.0, math.radians(ang))
        for lod, suf in ((0, "hi"), (1, "lo")):
            ob = bpy.data.objects.new(f"{name}_{suf}", meshes[(kind, lod)])
            sc.collection.objects.link(ob)
            ob.parent = e
        return e

    grp = vg.empty("booster_engines", (0, 0, 0))
    slots = booster_engines()
    for i, s in enumerate(slots):
        kind = "sl_fixed" if s["ring"] == "outer" else "sl_gimbal"
        place(f"raptor_{i:02d}", kind, s["x"], 0.0, s["z"], s["ang"], grp)
    sgrp = vg.empty("ship_engines", (0, 0, 0))
    rv_r, rs_r = val("vehicle.ship.rvac.radius"), val("vehicle.ship.rsl.radius")
    for i, az in enumerate(val("vehicle.ship.rvac.azimuth_deg")):
        a = math.radians(az)
        place(f"raptor_rvac_{i}", "rvac", rv_r * math.cos(a), vs.SH0, -rv_r * math.sin(a), az, sgrp)
    for i, az in enumerate(val("vehicle.ship.rsl.azimuth_deg")):
        a = math.radians(az)
        place(f"raptor_rsl_{i}", "sl_gimbal", rs_r * math.cos(a), vs.SH0 + 0.2, -rs_r * math.sin(a), az, sgrp)
    lap("engines placed")

    return stats


def export():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(filepath=OUT_GLB, export_format="GLB", export_apply=False, export_yup=True, export_normals=True,
              export_texcoords=True, export_materials="EXPORT", export_cameras=False, export_lights=False,
              export_extras=False, export_animations=False, export_draco_mesh_compression_enable=False)
    kw = {k: v for k, v in kw.items() if k in props}
    missing = [k for k in ("export_format", "export_yup") if k not in props]
    if missing:
        print("[vehicle] WARNING glTF options missing:", missing)
    bpy.ops.export_scene.gltf(**kw)
    lap(f"exported {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1e6:.2f} MB)")


if __name__ == "__main__":
    stats = build()
    tris = sum(v for k, v in stats.items() if not k.startswith("engine_"))
    e_hi = 33 * max(stats["engine_sl_fixed_lod0"], stats["engine_sl_gimbal_lod0"])
    print("[vehicle] triangles per part:", json.dumps(stats))
    print(f"[vehicle] body tris {tris:,}; engines (hi, if all resolved) ~{e_hi:,} + ship engines")
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    lap("saved blend")
    if "--no-export" not in ARGS:
        export()
