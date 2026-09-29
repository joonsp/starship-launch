"""Geometry helpers for headless Blender model builds (from the RK 62 explainer).

Copy to <project>/blender/lib.py. The project root is the parent of this file's directory.

All public helpers take coordinates in millimetres in the *three.js frame*
(x = forward/muzzle, y = up, z = rifle's right). They are converted to Blender
space (metres, Z-up) so that the glTF exporter's +Y-up conversion lands them
back in the three.js frame exactly: three (x, y, z) -> blender (x, -z, y).
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

S = 0.001
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def V(x, y, z=0.0):
    return Vector((x * S, -z * S, y * S))


# ---------------------------------------------------------------- specs

def load_specs(name=None):
    """Load specs/<name>.json (default: the only/first .json in specs/). Returns (spec, {key: value})."""
    d = os.path.join(ROOT, "specs")
    if name is None:
        name = sorted(f for f in os.listdir(d) if f.endswith(".json"))[0]
    elif not name.endswith(".json"):
        name += ".json"
    with open(os.path.join(d, name), encoding="utf-8") as f:
        spec = json.load(f)
    vals = {k: v["v"] for k, v in spec["values"].items()}
    return spec, vals


# ---------------------------------------------------------------- scene

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


MATS = {}


def make_material(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
    MATS[name] = m
    return m


def setup_materials():
    # Linear-space colours.
    make_material("steel", (0.045, 0.047, 0.050), metallic=0.85, roughness=0.55)        # parkerized receiver/cover
    make_material("blued", (0.030, 0.032, 0.040), metallic=0.9, roughness=0.38)         # barrel
    make_material("steel_bright", (0.30, 0.30, 0.31), metallic=1.0, roughness=0.32)     # machined internals
    make_material("plastic", (0.020, 0.024, 0.020), metallic=0.0, roughness=0.62)      # Maranyl furniture
    make_material("spring", (0.10, 0.10, 0.11), metallic=1.0, roughness=0.42)
    make_material("brass", (0.78, 0.52, 0.22), metallic=1.0, roughness=0.28)
    make_material("copper", (0.80, 0.40, 0.26), metallic=1.0, roughness=0.30)
    make_material("primer", (0.60, 0.56, 0.50), metallic=1.0, roughness=0.35)
    make_material("tritium", (0.2, 1.0, 0.3), roughness=0.3, emission=(0.3, 1.0, 0.35), emission_strength=3.0)
    make_material("section", (0.62, 0.10, 0.07), metallic=0.0, roughness=0.8)           # cut faces (replaced in three.js)


# ---------------------------------------------------------------- mesh creation

def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def obj_from_bm(name, bm, mat=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(MATS[mat])
    return _link(ob)


def lathe(name, prof, seg=40, cy=0.0, cz=0.0, mat=None, phase=0.5):
    """Revolve a closed (x, r) polygon about an axis parallel to x through (cy, cz)."""
    bm = bmesh.new()
    rings = []
    for (x, r) in prof:
        if r < 1e-6:
            v = bm.verts.new(V(x, cy, cz))
            rings.append([v] * seg)
        else:
            ring = []
            for i in range(seg):
                a = 2 * math.pi * (i + phase) / seg
                ring.append(bm.verts.new(V(x, cy + r * math.cos(a), cz + r * math.sin(a))))
            rings.append(ring)
    n = len(rings)
    for k in range(n):
        a, b = rings[k], rings[(k + 1) % n]
        for i in range(seg):
            j = (i + 1) % seg
            quad = []
            for v in (a[i], a[j], b[j], b[i]):
                if v not in quad:
                    quad.append(v)
            if len(quad) >= 3:
                try:
                    bm.faces.new(quad)
                except ValueError:
                    pass
    return obj_from_bm(name, bm, mat)


def lathe_axis(name, prof, origin, axis, seg=40, mat=None, phase=0.5):
    """Revolve a closed (t, r) profile about an ARBITRARY axis (three-frame mm): origin + t·axis.

    Use for vertical cylinders, inclined valves, etc. The profile must be a closed polygon
    (outer radius going one way, inner radius coming back); r = 0 points close the ends."""
    ob = lathe(name, prof, seg=seg, mat=mat, phase=phase)       # built about the x axis
    ax = Vector(V(*axis)).normalized()
    rot = Vector((1, 0, 0)).rotation_difference(ax).to_matrix().to_4x4()
    ob.data.transform(Matrix.Translation(V(*origin)) @ rot)
    return ob


def helix_axis(name, origin, axis, length, r, wire, coils, mat="spring", steps_per_coil=16):
    """Coil spring from origin along an arbitrary axis (three-frame mm). Origin = fixed end (scale along the axis in three.js)."""
    ob = helix(name, 0.0, length, r, wire, coils, mat=mat, steps_per_coil=steps_per_coil)
    ax = Vector(V(*axis)).normalized()
    rot = Vector((1, 0, 0)).rotation_difference(ax).to_matrix().to_4x4()
    ob.data.transform(Matrix.Translation(V(*origin)) @ rot)
    return ob


def _prism(bm, loop_a, loop_b):
    n = len(loop_a)
    bm.faces.new(loop_a)
    bm.faces.new(loop_b[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([loop_a[i], loop_a[j], loop_b[j], loop_b[i]])
    # NB: do not triangulate the (possibly concave) caps here; the exact boolean
    # solver mis-handles bmesh's triangulation of them and can return an empty mesh.


def extrude_z(name, pts, z0, z1, mat=None):
    """Side-profile polygon [(x, y)] extruded across the rifle (z0..z1)."""
    bm = bmesh.new()
    a = [bm.verts.new(V(x, y, z0)) for x, y in pts]
    b = [bm.verts.new(V(x, y, z1)) for x, y in pts]
    _prism(bm, a, b)
    return obj_from_bm(name, bm, mat)


def extrude_x(name, sec, x0, x1, mat=None):
    """Cross-section polygon [(z, y)] extruded along the bore (x0..x1)."""
    bm = bmesh.new()
    a = [bm.verts.new(V(x0, y, z)) for z, y in sec]
    b = [bm.verts.new(V(x1, y, z)) for z, y in sec]
    _prism(bm, a, b)
    return obj_from_bm(name, bm, mat)


def extrude_y(name, pts, y0, y1, mat=None):
    """Plan-view polygon [(x, z)] extruded vertically (y0..y1)."""
    bm = bmesh.new()
    a = [bm.verts.new(V(x, y0, z)) for x, z in pts]
    b = [bm.verts.new(V(x, y1, z)) for x, z in pts]
    _prism(bm, a, b)
    return obj_from_bm(name, bm, mat)


def box(name, x0, x1, y0, y1, z0, z1, mat=None):
    return extrude_z(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat)


def rounded_rect(w, h, r, n=4, cz=0.0, cy=0.0):
    """Rounded rectangle polygon in (z, y), centred at (cz, cy) — the order extrude_x expects.
    For extrude_y (which wants (x, z)) or extrude_z ((x, y)) swap/remap the tuple order yourself."""
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for cx_, cy_, a0 in corners:
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cz + cx_ + r * math.cos(a), cy + cy_ + r * math.sin(a)))
    return pts


def circle_pts(r, n=24, cx=0.0, cy=0.0, a0=0.0, a1=360.0):
    full = abs(a1 - a0) >= 360
    cnt = n if full else n + 1
    out = []
    for i in range(cnt):
        a = math.radians(a0 + (a1 - a0) * i / n)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def cyl(name, p0, p1, r, seg=24, mat=None):
    """Cylinder between two three-frame points (mm)."""
    p0v, p1v = V(*p0), V(*p1)
    d = p1v - p0v
    length = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * S, radius2=r * S, depth=length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bm.transform(Matrix.Translation((p0v + p1v) / 2) @ rot)
    return obj_from_bm(name, bm, mat)


def curve_tube(name, pts, radius, mat=None, closed=False, res=6, smooth=False):
    """Sweep a circle along a 3D polyline (three-frame mm), returns a mesh object."""
    cu = bpy.data.curves.new(name + "_cu", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius * S
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    if smooth:
        sp = cu.splines.new("NURBS")
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            v = V(*p)
            sp.points[i].co = (v.x, v.y, v.z, 1.0)
        sp.use_endpoint_u = True
        sp.order_u = 3
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            v = V(*p)
            sp.points[i].co = (v.x, v.y, v.z, 1.0)
    sp.use_cyclic_u = closed
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    _link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.name = name
    ob = bpy.data.objects.new(name, me)
    me.materials.clear()
    if mat:
        me.materials.append(MATS[mat])
    return _link(ob)


def helix(name, x0, x1, r, wire, coils, cy=0.0, cz=0.0, mat="spring", steps_per_coil=16):
    pts = []
    n = int(coils * steps_per_coil)
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * coils * t
        pts.append((x0 + (x1 - x0) * t, cy + r * math.cos(a), cz + r * math.sin(a)))
    return curve_tube(name, pts, wire / 2, mat=mat, res=2)


# ---------------------------------------------------------------- modifiers / ops

def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def boolean(ob, cutters, op="DIFFERENCE", transfer=False, keep=False, robust=False):
    if not isinstance(cutters, (list, tuple)):
        cutters = [cutters]
    for c in cutters:
        m = ob.modifiers.new("bool", "BOOLEAN")
        m.operation = op
        m.solver = "EXACT"
        m.object = c
        if robust:
            m.use_self = True
            m.use_hole_tolerant = True
        try:
            m.material_mode = "TRANSFER" if transfer else "INDEX"
        except (AttributeError, TypeError):
            pass
        c.hide_render = True
        apply_modifiers(ob)
        clean_slots(ob)
    if not keep:
        for c in cutters:
            me = c.data
            bpy.data.objects.remove(c)
            if me.users == 0:
                bpy.data.meshes.remove(me)
    return ob


def clean_slots(ob):
    """Faces cut by material-less cutters land in an empty slot: give them the part's main material."""
    me = ob.data
    empty = [i for i, m in enumerate(me.materials) if m is None]
    if not empty or len(me.materials) == len(empty):
        return
    main = next(i for i, m in enumerate(me.materials) if m is not None)
    for p in me.polygons:
        if p.material_index in empty:
            p.material_index = main
    for i in reversed(empty):
        me.materials.pop(index=i)
        for p in me.polygons:
            if p.material_index > i:
                p.material_index -= 1


def union(ob, others):
    return boolean(ob, others, op="UNION", transfer=True)


def bevel(ob, width=0.5, segs=2, angle=35.0, harden=False):
    m = ob.modifiers.new("bevel", "BEVEL")
    m.harden_normals = harden
    m.width = width * S
    m.segments = segs
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    apply_modifiers(ob)
    return ob


def smooth(ob, angle=38.0):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))
    return ob


def join(name, obs):
    """Merge several mesh objects into one (keeping their materials)."""
    bm = bmesh.new()
    mats = []
    for ob in obs:
        me = ob.data
        local_to_idx = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            local_to_idx.append(mats.index(m))
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.transform(ob.matrix_world)
        for f in tmp.faces:
            f.material_index = local_to_idx[f.material_index] if local_to_idx else 0
        me2 = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me2)
        tmp.free()
        bm.from_mesh(me2)
        bpy.data.meshes.remove(me2)
    for ob in obs:
        me = ob.data
        bpy.data.objects.remove(ob)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    return _link(ob)


def set_origin(ob, x, y, z=0.0):
    p = V(x, y, z)
    ob.data.transform(Matrix.Translation(-p))
    ob.location = ob.location + p
    return ob


def set_parent(child, parent):
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def finish(ob, bevel_w=0.4, segs=2, angle=35.0, smooth_angle=38.0, harden=True):
    if not harden:
        if bevel_w > 0:
            bevel(ob, bevel_w, segs, angle)
        return smooth(ob, smooth_angle)
    # smooth first, then bevel with hardened normals: flat faces stay flat, only the bevels are
    # smooth-shaded. The three.js shader detects those bevels (normal curvature) for edge wear.
    smooth(ob, smooth_angle)
    if bevel_w > 0:
        bevel(ob, bevel_w, segs, angle, harden=True)
    return ob


def make_cut_variant(ob, cut_z=0.0):
    """Duplicate ob and remove the viewer-side half (z > cut_z in three-frame mm), capping cuts with 'section'.

    The cutter box is sized from the object's own bounds, so large parts are always fully cut."""
    dup = ob.copy()
    dup.data = ob.data.copy()
    dup.name = ob.name + "__cut"
    dup.data.name = dup.name
    _link(dup)
    for k in ob.keys():
        dup[k] = ob[k]
    dup["cutVariant"] = True
    corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    # three-frame extents (mm): x = bx, y = bz, z = -by
    xs = [c.x / S for c in corners]; ys = [c.z / S for c in corners]; zs = [-c.y / S for c in corners]
    pad = 50.0
    cutter = box("cutter", min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad, cut_z, max(zs) + pad, mat="section")
    boolean(dup, cutter, transfer=True, robust=True)
    dup.data.validate(clean_customdata=False)
    smooth(dup, 38.0)
    return dup


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )


# ---------------------------------------------------------------- part bookkeeping (from the RK 62 build)

def report(ob):
    """Print vertex/face/non-manifold counts — run on every part; empty or non-manifold results signal a failed boolean."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    vol = bm.calc_volume(signed=True) * 1e9
    print(f"[part] {ob.name:18s} verts={len(bm.verts):6d} faces={len(bm.faces):6d} nonmanifold={nm} volume={vol:.0f} mm3")
    bm.free()


def tag(ob, pid, name=None, **extra):
    """Rename object+mesh to the part id (renaming any stale holder of that name) and set custom props (→ glTF extras)."""
    want = name or pid
    other = bpy.data.objects.get(want)
    if other is not None and other is not ob:
        other.name = want + "_old"
    ob.name = want
    ob.data.name = want
    ob.data.validate(clean_customdata=False)
    report(ob)
    ob["part"] = pid
    for k, v in extra.items():
        ob[k] = v
    return ob


def rot2(pts, deg, ox=0.0, oy=0.0):
    """Rotate 2-D points (mm) by deg about (ox, oy)."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(ox + x * c - y * s, oy + x * s + y * c) for x, y in pts]


def box_polar(name, x0, x1, r0, r1, psi_deg, half_w, cy=0.0, mat=None):
    """Box around an x-parallel axis at polar angle psi (0 = +z/right, 90 = +y/up): lugs, slots, cam tracks."""
    a = math.radians(psi_deg)
    ur = (math.cos(a), math.sin(a))
    ut = (-math.sin(a), math.cos(a))
    sec = [(ur[0] * r + ut[0] * t, cy + ur[1] * r + ut[1] * t) for r, t in ((r0, -half_w), (r1, -half_w), (r1, half_w), (r0, half_w))]
    return extrude_x(name, sec, x0, x1, mat)


def loft_solid(name, secs, mat=None):
    """Closed solid through a list of equal-length rings of (x, y, z) mm points (curved bodies, ducts, magazines)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(V(*p)) for p in s] for s in secs]
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    for a, b in zip(rings[:-1], rings[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    return obj_from_bm(name, bm, mat)
