"""Build Launch Pad 2 (tower 2, chopsticks, OLM, flame trench, apron, tank farm, GSE, Pad 1) and export
public/models/pad.glb + public/data/colliders.json.

Run:  bash blender/run.sh blender/build_pad.py            (add  -- --no-export  to only save the .blend)

Frame: three.js frame (src/contracts.ts): metres, origin = vehicle axis at ground, x east, y up, z south. The GLB
needs no transform in the app. Repeated parts (tower bays, tanks) are LINKED DUPLICATES: one mesh, many nodes;
src/pad/index.ts converts identical geometry into InstancedMesh. No UVs are exported: every pad material is
procedural in world / object space (src/pad/materials.ts).

Object names (see src/pad/index.ts for the role table):
  tower_lattice_a/b/lo (.NN duplicates), tower_base, tower_rails, tower_top, tower_masts, tower_boom, tower_elevator,
  chopsticks, olm_deck, olm_details, olm_columns, olm_pipes, olm_stairs, trench, diverter, trench_pipes, apron,
  fence, lights, gse_pipes, pipes, tanks_<class>_<d>x<l> (.NN), tower1_lattice (.NN), tower1_top, tower1_chopsticks,
  tower1_mount, tower1_ground
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
import numpy as np  # noqa: E402

import pad_chopsticks as pc  # noqa: E402
import pad_extras as pe  # noqa: E402
import pad_geo as pg  # noqa: E402
import pad_layout as L  # noqa: E402
import pad_olm as po  # noqa: E402
import pad_site as ps  # noqa: E402
import pad_tower as pt  # noqa: E402
import pad_trench as ptr  # noqa: E402
from pad_geo import Geo  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = os.path.join(ROOT, "public", "models", "pad.glb")
OUT_COL = os.path.join(ROOT, "public", "data", "colliders.json")
OUT_BLEND = os.path.join(ROOT, "out", "pad", "pad.blend")

t0 = time.time()


def lap(msg):
    print(f"[pad] {time.time() - t0:6.1f}s {msg}", flush=True)


# material roles: (linear-ish base colour, metallic, roughness). Only matter for Blender previews; three.js replaces them.
MATERIALS = {
    "tower_paint": ((0.16, 0.05, 0.04), 0.5, 0.6), "tower_clad": ((0.15, 0.05, 0.045), 0.4, 0.7),
    "galv": ((0.5, 0.5, 0.5), 1.0, 0.4), "grating": ((0.3, 0.3, 0.3), 0.9, 0.5),
    "dark_steel": ((0.05, 0.05, 0.055), 0.9, 0.5), "beacon": ((1.0, 0.05, 0.02), 0.0, 0.3),
    "concrete": ((0.35, 0.34, 0.32), 0.0, 0.9), "concrete_scorch": ((0.2, 0.19, 0.18), 0.0, 0.9),
    "apron": ((0.3, 0.27, 0.25), 0.0, 0.9), "stainless": ((0.6, 0.6, 0.62), 1.0, 0.3),
    "diverter": ((0.04, 0.035, 0.03), 0.9, 0.6), "olm_steel": ((0.35, 0.35, 0.37), 0.9, 0.4),
    "olm_column": ((0.4, 0.4, 0.42), 0.6, 0.6), "tank_lox": ((0.8, 0.82, 0.85), 0.2, 0.4),
    "tank_ln2": ((0.8, 0.82, 0.85), 0.2, 0.4), "tank_ch4": ((0.8, 0.82, 0.85), 0.2, 0.4),
    "tank_water": ((0.6, 0.65, 0.7), 0.3, 0.5), "tank_gas": ((0.7, 0.7, 0.72), 0.3, 0.5),
    "tank_band": ((0.5, 0.5, 0.52), 0.8, 0.4), "pipe_insul": ((0.8, 0.8, 0.8), 0.1, 0.6),
    "fence_mesh": ((0.3, 0.3, 0.3), 0.8, 0.5), "annex": ((0.5, 0.5, 0.46), 0.2, 0.6),
}
_MAT = {}


def get_material(name):
    if name in _MAT:
        return _MAT[name]
    col, met, rough = MATERIALS.get(name, ((0.5, 0.5, 0.5), 0.0, 0.5))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = met
    b.inputs["Roughness"].default_value = rough
    if name == "beacon":
        b.inputs["Emission Color"].default_value = (1.0, 0.05, 0.02, 1.0)
        b.inputs["Emission Strength"].default_value = 5.0
    _MAT[name] = m
    return m


STATS = {}
OBJS = {}


def add_object(name, geo, loc=(0, 0, 0), yaw_deg=0.0, mesh=None):
    """Create (or link a duplicate of) a mesh object. loc in three-frame metres, yaw = three rotation.y in degrees."""
    if mesh is None:
        mesh = pg.to_blender_mesh(geo, name, bpy, get_material)
        STATS[name] = geo.tri_count()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (loc[0], -loc[2], loc[1])
    ob.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    OBJS[name] = ob
    return ob, mesh


def yaw_of_x(ax, az):
    return math.degrees(math.atan2(-az, ax))


colliders = []


def col_box(cid, centre, size, rot=0.0):
    colliders.append(dict(id=cid, kind="box", centre=[round(float(c), 3) for c in centre],
                          size=[round(float(s), 3) for s in size], rotationY=round(float(math.radians(rot)), 5)))


def col_local(cid, centre, size, rot=0.0):
    """Box given in the PAD-LOCAL frame: centre rotated into world by PAD_YAW, box yaw = PAD_YAW + rot (degrees)."""
    x, z = L.pad_to_world_xz(centre[0], centre[2])
    col_box(cid, (x, centre[1], z), size, L.PAD_YAW + rot)


def col_cyl_local(cid, centre, r, h):
    x, z = L.pad_to_world_xz(centre[0], centre[2])
    col_cyl(cid, (x, centre[1], z), r, h)


def col_cyl(cid, centre, r, h):
    colliders.append(dict(id=cid, kind="cylinder", centre=[round(float(c), 3) for c in centre], radius=round(float(r), 3),
                          height=round(float(h), 3)))


def build_tower(centre, yaw, nb, prefix, hi):
    """Bays as linked duplicates. Tower 2 gets hi (alternating platform / no platform) and lo LOD sets."""
    if hi:
        ga, gb = pt.bay_geo(platform=True), pt.bay_geo(platform=False)
        mesh_a = pg.to_blender_mesh(ga, "tower_lattice_a", bpy, get_material)
        mesh_b = pg.to_blender_mesh(gb, "tower_lattice_b", bpy, get_material)
        STATS["tower_lattice_a"] = ga.tri_count()
        STATS["tower_lattice_b"] = gb.tri_count()
    glo = pt.bay_geo(lo=True)
    mesh_lo = pg.to_blender_mesh(glo, "tower_lattice_lo", bpy, get_material)
    STATS["tower_lattice_lo"] = glo.tri_count()
    for i in range(nb):
        loc = (centre[0], i * pt.BAY, centre[2])
        if hi:
            add_object("tower_lattice_a" if i % 2 == 0 else "tower_lattice_b", None, loc, yaw, mesh_a if i % 2 == 0 else mesh_b)
        add_object(prefix + "_lo", None, loc, yaw, mesh_lo)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0

    # ---------------------------------------------------------------- tower 2
    build_tower(L.TOWER_C, L.TOWER_YAW, L.N_BAYS, "tower_lattice", True)
    lap("tower bays")
    R = L.yaw_mat(L.TOWER_YAW)
    for name, geo in (("tower_base", pt.base_geo()), ("tower_rails", pt.rails_geo()), ("tower_top", pt.top_geo()),
                      ("tower_masts", pt.masts_geo()), ("tower_boom", pt.boom_geo())):
        add_object(name, geo, L.TOWER_C, L.TOWER_YAW)
    add_object("tower_annex", pe.tower_annex(), L.TOWER_C, L.TOWER_YAW)
    add_object("tower_beacons", pe.tower_beacons(), L.TOWER_C, L.TOWER_YAW)
    add_object("tower_elevator", pt.elevator_car(), L.tower_to_world([[0, 46.0, -(L.TOWER_HW + pt.CHORD / 2 + 0.55) - 0.4]])[0], L.TOWER_YAW)
    lap("tower unique")
    chop = pc.carriage_geo()
    chop.extend(pc.arms_geo())
    chop.extend(pc.actuators_geo())
    add_object("chopsticks", chop)
    lap("chopsticks")

    # ---------------------------------------------------------------- OLM
    for name, geo in po.build().items():
        add_object(name, geo, yaw_deg=L.PAD_YAW)
    add_object("olm_platforms", pe.olm_platforms(), yaw_deg=L.PAD_YAW)
    lap("olm")
    # ---------------------------------------------------------------- trench, apron
    for name, geo in ptr.build().items():
        add_object(name, geo, yaw_deg=L.PAD_YAW)
    add_object("apron_props", pe.apron_props(), yaw_deg=L.PAD_YAW)
    lap("trench + apron")

    # ---------------------------------------------------------------- tanks
    tanks = ps.extract_tanks()
    meshes = {}
    n_h = n_v = 0
    for i, t in enumerate(tanks):
        key = (t["kind"], t["cls"], t["dia"], t["length"])
        mname = f"tanks_{t['cls'][5:]}_{'h' if t['kind'] == 'h' else 'v'}{t['dia']:.1f}x{t['length']:.1f}".replace(".", "_")
        if key not in meshes:
            geo = ps.horizontal_tank(t["cls"], t["dia"], t["length"]) if t["kind"] == "h" else ps.vertical_tank(t["cls"], t["dia"], t["length"])
            meshes[key] = pg.to_blender_mesh(geo, mname, bpy, get_material)
            STATS[mname] = geo.tri_count()
        add_object(mname, None, (t["centre"][0], 0.0, t["centre"][1]), t["yaw"], meshes[key])
        x, z = t["centre"]
        if t["kind"] == "h":
            n_h += 1
            R_ = t["dia"] / 2
            col_box(f"tank_h_{i}", (x, 1.1 + R_, z), (t["length"] + 1.0, t["dia"] + 0.3, t["dia"] + 0.3), t["yaw"])
        else:
            n_v += 1
            col_cyl(f"tank_v_{i}", (x, (t["length"] + 0.9) / 2, z), t["dia"] / 2 + 0.1, t["length"] + 0.9)
    lap(f"tanks: {n_h} horizontal, {n_v} vertical, {len(meshes)} unique meshes")

    # ---------------------------------------------------------------- pipes
    add_object("pipes", ps.pipeline_geo(ps.extract_pipelines()))
    add_object("gse_pipes", ps.gse_geo())

    # ---------------------------------------------------------------- pad 1 (low detail)
    glo = pt.bay_geo(lo=True)
    mesh_lo1 = bpy.data.meshes.get("tower_lattice_lo")
    n1 = int(L.P1_H // pt.BAY)          # 23 bays -> 138 m of lattice (143 m incl. house/masts)
    for i in range(22):
        add_object("tower1_lattice", None, (L.P1_C[0], i * pt.BAY, L.P1_C[2]), L.P1_YAW, mesh_lo1)
    top1 = pt.top_geo()
    top1.extend(pt.masts_geo())
    add_object("tower1_top", top1, (L.P1_C[0], -1.0, L.P1_C[2]), L.P1_YAW)
    add_object("tower1_chopsticks", ps.pad1_chopsticks())
    add_object("tower1_mount", ps.pad1_mount())
    add_object("tower1_ground", ps.pad1_ground())
    lap("pad 1")

    # ---------------------------------------------------------------- colliders
    hw = L.TOWER_HW
    for k, (a, b) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        p = L.tower_to_world([[a * hw, 0, b * hw]])[0]
        col_box(f"tower2_footing_{k}", (p[0], 0.6, p[2]), (4.2, 1.8, 4.2), L.TOWER_YAW)
        col_box(f"tower2_leg_{k}", (p[0], 66.0, p[2]), (1.5, 132.0, 1.5), L.TOWER_YAW)
    # the annex: two wings of the L as boxes in tower-local coordinates (walls 10.5 m)
    for k, (loc, size) in enumerate((((-0.2, 5.25, -9.0), (12.0, 10.5, 5.8)), ((-8.6, 5.25, -0.3), (5.6, 10.5, 11.0)))):
        p = L.tower_to_world([loc])[0]
        col_box(f"tower2_annex_{k}", (p[0], loc[1], p[2]), size, L.TOWER_YAW)
    for k, (x, z) in enumerate(po.COLUMNS):
        col_local(f"olm_column_{k}", (x, 10.0, z), (2.6, 20.0, 2.6))
    # guard fence round the trench / mount enclosure (segments as built, with the gaps for tower 2 and the pipe crossings)
    for k, ((x0, z0), (x1, z1)) in enumerate(ptr.fence_runs()):
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        ln = math.hypot(x1 - x0, z1 - z0)
        size = (ln, 1.3, 0.25) if abs(z1 - z0) < 1e-6 else (0.25, 1.3, ln)
        col_local(f"trench_fence_{k}", (cx, 0.65, cz), size)
    col_local("olm_stair_base", (8.0, 10.0, 20.0), (6.6, 20.0, 2.0))
    for k, (x, z) in enumerate(ptr.LIGHT_POLES):
        col_cyl_local(f"lightpole_{k}", (x, 8.0, z), 0.7, 16.0)
    for k, (a, b) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        p = L.tower_to_world([[a * hw, 0, b * hw]], L.P1_C, L.P1_YAW)[0]
        col_box(f"tower1_footing_{k}", (p[0], 0.6, p[2]), (3.6, 1.8, 3.6), L.P1_YAW)
        col_box(f"tower1_leg_{k}", (p[0], 66.0, p[2]), (2.0, 132.0, 2.0), L.P1_YAW)
    for k in range(6):
        a = math.radians(k * 60 + 15)
        col_cyl(f"pad1_leg_{k}", (L.P1_AXIS[0] + 12.0 * math.cos(a), 8.0, L.P1_AXIS[2] - 12.0 * math.sin(a)), 1.4, 16.0)
    # GSE riser posts + pipe rack ends
    for k, (x, z) in enumerate(ps.gse_riser_positions()):
        col_cyl(f"gse_riser_{k}", (x, 10.0, z), 0.5, 20.0)
    zc = ps.GSE_RUN_Z0 - ps.GSE_RUN_D
    x0, x1 = ps.GSE_WORLD_TURN_X, 128.0
    col_box("gse_rack_north", ((x0 + x1) / 2, 1.3, zc), (x1 - x0, 2.6, 5.5))
    (wx0, wz0), (wx1, wz1) = ps.WATER_LOCAL
    col_local("gse_water_main", (wx0, 0.7, (wz0 + wz1) / 2), (1.6, 1.4, abs(wz1 - wz0)))
    lap(f"colliders: {len(colliders)}")

    # ---------------------------------------------------------------- outputs
    tot = sum(v for v in STATS.values())
    print("[pad] unique-mesh triangles:", json.dumps(STATS))
    n_inst = sum(1 for ob in OBJS.values())
    # rendered (instanced) triangle estimate
    rendered = 0
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            rendered += len(ob.data.polygons)
    print(f"[pad] unique tris {tot:,}; rendered tris (all nodes, hi+lo) {rendered:,}")
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    lap("saved blend")
    os.makedirs(os.path.dirname(OUT_COL), exist_ok=True)
    with open(OUT_COL, "w", encoding="utf-8") as f:
        json.dump(colliders, f, indent=0)
    lap(f"wrote {OUT_COL}")
    if "--no-export" not in ARGS:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
        kw = dict(filepath=OUT_GLB, export_format="GLB", export_apply=False, export_yup=True, export_normals=True,
                  export_texcoords=False, export_materials="EXPORT", export_cameras=False, export_lights=False,
                  export_extras=False, export_animations=False, export_draco_mesh_compression_enable=False,
                  export_tangents=False, export_vertex_color="NONE")
        kw = {k: v for k, v in kw.items() if k in props}
        bpy.ops.export_scene.gltf(**kw)
        lap(f"exported {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
