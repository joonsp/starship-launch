"""Geometry kit for the vehicle build (numpy based, analytic normals).

Everything is authored in the THREE.JS frame (x east, y up, z south, metres) and converted to
Blender space (x, -z, y) only when a Blender mesh is created, so the glTF exporter's +Y-up
conversion lands the model back in the three.js frame (same convention as lib.V).

A `Geo` is a bag of chunks. A chunk is an indexed mesh with per-vertex normals and UVs and one
material NAME (Blender material names double as roles in three.js: see src/vehicle/materials.ts).
Hard edges are made by duplicating vertices (a chunk boundary or a new strip), never by Blender
auto-smooth, so the normals that reach the glTF are exactly the ones authored here.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

TAU = math.tau


def _norm(a, eps=1e-12):
    n = np.linalg.norm(a, axis=-1, keepdims=True)
    return a / np.maximum(n, eps)


class Chunk:
    __slots__ = ("P", "N", "UV", "F", "mat")

    def __init__(self, P, N, UV, F, mat):
        self.P = np.asarray(P, dtype=np.float64)
        self.N = np.asarray(N, dtype=np.float64)
        self.UV = np.asarray(UV, dtype=np.float64)
        self.F = np.asarray(F, dtype=np.int64)  # (n,3) or (n,4)
        self.mat = mat


class Geo:
    def __init__(self, chunks=None):
        self.chunks = list(chunks or [])

    def add(self, other):
        if isinstance(other, Geo):
            self.chunks += other.chunks
        elif other is not None:
            self.chunks.append(other)
        return self

    def __iadd__(self, other):
        return self.add(other)

    def transformed(self, M):
        """Apply a 4x4 mathutils Matrix (three-frame) and return a new Geo (normals rotated only)."""
        m = np.array(M, dtype=np.float64)
        R = m[:3, :3]
        t = m[:3, 3]
        Rn = np.linalg.inv(R).T
        out = []
        mirrored = np.linalg.det(R) < 0
        for c in self.chunks:
            F = c.F[:, ::-1].copy() if mirrored else c.F   # a reflection flips the winding
            out.append(Chunk(c.P @ R.T + t, _norm(c.N @ Rn.T), c.UV, F, c.mat))
        return Geo(out)

    def mat_all(self, mat):
        for c in self.chunks:
            c.mat = mat
        return self

    def tri_count(self):
        return int(sum(len(c.F) * (2 if c.F.shape[1] == 4 else 1) for c in self.chunks))


# ------------------------------------------------------------------------------------ primitives

def surface(pos, rows, nu, strips=None, mat="steel", uv=None, inward=False, ref_row=None, radial_axis=(0.0, 0.0)):
    """Parametric surface, closed around u in [0,1] (column nu duplicates column 0 so UVs do not smear).

    pos(U, row) -> (len(U),3) array (three-frame) for the u samples U and a row descriptor.
    rows: list of row descriptors. strips: list of (a, b) inclusive row ranges; every strip is smooth
    inside and hard-edged against its neighbours (vertices are not shared between strips).
    Normals are the analytic cross product of the u and v derivatives, oriented radially outward from
    `radial_axis` (x, z) on the reference row, or inward when `inward`.
    uv(U, row, P) -> (len(U),2); default (u, y / 20).
    """
    if strips is None:
        strips = [(0, len(rows) - 1)]
    U = np.linspace(0.0, 1.0, nu + 1)
    du = 0.25 / nu
    chunks = []
    ax, az = radial_axis
    for (a, b) in strips:
        Ps, Ns, UVs = [], [], []
        for j in range(a, b + 1):
            P = pos(U, rows[j])
            dPu = pos(U + du, rows[j]) - pos(U - du, rows[j])
            jm, jp = max(a, j - 1), min(b, j + 1)
            dPv = pos(U, rows[jp]) - pos(U, rows[jm])
            n = np.cross(dPu, dPv)
            Ps.append(P)
            Ns.append(n)
            UVs.append(uv(U, rows[j], P) if uv else np.stack([U, P[:, 1] / 20.0], axis=1))
        P = np.stack(Ps)  # (R, nu+1, 3)
        N = np.stack(Ns)
        UVa = np.stack(UVs)
        rr = (ref_row - a) if (ref_row is not None and a <= ref_row <= b) else (b - a) // 2
        rad = np.stack([P[rr, :, 0] - ax, np.zeros(nu + 1), P[rr, :, 2] - az], axis=1)
        s = np.sum(np.einsum("ij,ij->i", N[rr], rad))
        sign = 1.0 if s >= 0 else -1.0
        if inward:
            sign = -sign
        N = _norm(N * sign)
        R = b - a + 1
        idx = np.arange(R * (nu + 1)).reshape(R, nu + 1)
        # quad (i,j) (i+1,j) (i+1,j+1) (i,j+1): winding decided below against the normals
        q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], axis=-1).reshape(-1, 4)
        Pf = P.reshape(-1, 3)
        Nf = N.reshape(-1, 3)
        e1 = Pf[q[:, 1]] - Pf[q[:, 0]]
        e2 = Pf[q[:, 3]] - Pf[q[:, 0]]
        fn = np.cross(e1, e2)
        avg = Nf[q].sum(axis=1)
        flip = np.einsum("ij,ij->i", fn, avg) < 0
        q[flip] = q[flip][:, ::-1]
        ok = np.linalg.norm(fn, axis=1) > 1e-14  # drop degenerate quads (pole rows)
        chunks.append(Chunk(Pf, Nf, UVa.reshape(-1, 2), q[ok], mat))
    return Geo(chunks)


def revolve_profile(rows_ry, nu=128, strips=None, mat="steel", phase=0.0, cx=0.0, cz=0.0, uvscale=20.0, **kw):
    """Surface of revolution about the vertical axis through (cx, cz). rows_ry = [(r, y), ...]."""
    def pos(U, row):
        r, y = row
        a = TAU * U + phase
        return np.stack([cx + r * np.cos(a), np.full_like(U, y), cz - r * np.sin(a)], axis=1)
    return surface(pos, rows_ry, nu, strips, mat, uv=lambda U, row, P: np.stack([U, P[:, 1] / uvscale], axis=1),
                   radial_axis=(cx, cz), **kw)


def disc(y, r, nu=48, mat="steel", up=True, cx=0.0, cz=0.0, r_in=0.0):
    """Flat horizontal disc or annulus at height y with the normal up (or down)."""
    a = TAU * np.arange(nu) / nu
    ring = np.stack([cx + r * np.cos(a), np.full(nu, y), cz - r * np.sin(a)], axis=1)
    if r_in > 0:
        ri = np.stack([cx + r_in * np.cos(a), np.full(nu, y), cz - r_in * np.sin(a)], axis=1)
        P = np.concatenate([ring, ri])
        idx = np.arange(nu)
        j = (idx + 1) % nu
        F = np.stack([idx, j, nu + j, nu + idx], axis=1)
    else:
        P = np.concatenate([ring, [[cx, y, cz]]])
        idx = np.arange(nu)
        F = np.stack([idx, (idx + 1) % nu, np.full(nu, nu)], axis=1)
    n = np.array([0.0, 1.0 if up else -1.0, 0.0])
    # winding: make geometric normal agree
    e1 = P[F[:, 1]] - P[F[:, 0]]
    e2 = P[F[:, -1]] - P[F[:, 0]]
    g = np.cross(e1, e2)
    flip = (g @ n) < 0
    F = F.copy()
    F[flip] = F[flip][:, ::-1]
    uv = np.stack([(P[:, 0] - cx) / (2 * r) + 0.5, (P[:, 2] - cz) / (2 * r) + 0.5], axis=1)
    return Geo([Chunk(P, np.tile(n, (len(P), 1)), uv, F, mat)])


def polygon(pts, mat="steel", normal=None):
    """Flat convex polygon (fan). Normal from the points unless given; winding fixed to match."""
    P = np.asarray(pts, dtype=np.float64)
    n = len(P)
    c = P.mean(axis=0)
    Pf = np.vstack([P, c])
    F = np.stack([np.arange(n), (np.arange(n) + 1) % n, np.full(n, n)], axis=1)
    g = np.cross(P[F[:, 1]] - P[F[:, 0]], c - P[F[:, 0]])
    gn = _norm(g.sum(axis=0, keepdims=True))[0]
    nn = gn if normal is None else np.asarray(normal, dtype=np.float64)
    if gn @ nn < 0:
        F = F[:, ::-1]
    return Geo([Chunk(Pf, np.tile(nn, (n + 1, 1)), np.zeros((n + 1, 2)), F, mat)])


def rbox(size, chamfer=0.02, mat="steel", centre=(0, 0, 0)):
    """Chamfered box, flat-shaded faces, centred at `centre`. size = full extents (x,y,z)."""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    c = min(chamfer, hx * 0.9, hy * 0.9, hz * 0.9)
    polys = []
    S = (-1, 1)
    for sx in S:
        polys.append([(sx * hx, sy * (hy - c), sz * (hz - c)) for sy, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for sy in S:
        polys.append([(sx * (hx - c), sy * hy, sz * (hz - c)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for sz in S:
        polys.append([(sx * (hx - c), sy * (hy - c), sz * hz) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    if c > 0:
        for sx in S:  # edges along z between x-face and y-face
            for sy in S:
                polys.append([(sx * hx, sy * (hy - c), -(hz - c)), (sx * (hx - c), sy * hy, -(hz - c)),
                              (sx * (hx - c), sy * hy, (hz - c)), (sx * hx, sy * (hy - c), (hz - c))])
        for sx in S:  # edges along y between x-face and z-face
            for sz in S:
                polys.append([(sx * hx, -(hy - c), sz * (hz - c)), (sx * (hx - c), -(hy - c), sz * hz),
                              (sx * (hx - c), (hy - c), sz * hz), (sx * hx, (hy - c), sz * (hz - c))])
        for sy in S:  # edges along x between y-face and z-face
            for sz in S:
                polys.append([(-(hx - c), sy * hy, sz * (hz - c)), (-(hx - c), sy * (hy - c), sz * hz),
                              ((hx - c), sy * (hy - c), sz * hz), ((hx - c), sy * hy, sz * (hz - c))])
        for sx in S:
            for sy in S:
                for sz in S:
                    polys.append([(sx * hx, sy * (hy - c), sz * (hz - c)), (sx * (hx - c), sy * hy, sz * (hz - c)),
                                  (sx * (hx - c), sy * (hy - c), sz * hz)])
    Ps, Ns, Fs = [], [], []
    base = 0
    for poly in polys:
        p = np.array(poly, dtype=np.float64)
        cen = p.mean(axis=0)
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if n @ cen < 0:
            p = p[::-1]
            n = -n
        nn = n / max(np.linalg.norm(n), 1e-12)
        k = len(p)
        Ps.append(p)
        Ns.append(np.tile(nn, (k, 1)))
        if k == 4:
            Fs.append([[base, base + 1, base + 2], [base, base + 2, base + 3]])
        else:
            Fs.append([[base, base + 1, base + 2]])
        base += k
    P = np.vstack(Ps) + np.asarray(centre)
    N = np.vstack(Ns)
    F = np.array([t for f in Fs for t in f])
    return Geo([Chunk(P, N, np.zeros((len(P), 2)), F, mat)])


def _frames(path):
    """Parallel-transport frames along a polyline. Returns tangents, normals, binormals."""
    path = np.asarray(path, dtype=np.float64)
    T = np.zeros_like(path)
    T[1:-1] = path[2:] - path[:-2]
    T[0] = path[1] - path[0]
    T[-1] = path[-1] - path[-2]
    T = _norm(T)
    ref = np.array([0.0, 1.0, 0.0]) if abs(T[0][1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    n0 = _norm(np.cross(T[0], ref))
    Ns = [n0]
    for i in range(1, len(path)):
        v = np.cross(T[i - 1], T[i])
        s = np.linalg.norm(v)
        n = Ns[-1]
        if s > 1e-9:
            axis = v / s
            ang = math.asin(min(1.0, s))
            # rotate n around axis by ang (Rodrigues)
            n = n * math.cos(ang) + np.cross(axis, n) * math.sin(ang) + axis * (axis @ n) * (1 - math.cos(ang))
        Ns.append(_norm(n))
    Ns = np.array(Ns)
    Bs = _norm(np.cross(T, Ns))
    return T, Ns, Bs


def tube(path, radius, seg=12, mat="steel", caps=True):
    """Swept circle along a polyline (radius scalar or per-point array)."""
    path = np.asarray(path, dtype=np.float64)
    K = len(path)
    rad = np.full(K, radius) if np.isscalar(radius) else np.asarray(radius)
    T, Nn, B = _frames(path)

    def pos(U, j):
        a = TAU * U
        return path[j] + rad[j] * (np.cos(a)[:, None] * Nn[j] + np.sin(a)[:, None] * B[j])

    g = surface(pos, list(range(K)), seg, mat=mat, uv=lambda U, j, P: np.stack([U, np.full_like(U, j * 0.1)], axis=1),
                radial_axis=(0, 0))
    # orientation: outward = away from the path point; re-orient by hand (radial_axis logic is not valid here)
    for c in g.chunks:
        pass
    # normals via surface() may be inverted for tubes (radial from the world axis); recompute robustly
    c = g.chunks[0]
    idxp = np.repeat(np.arange(K), seg + 1)
    outward = c.P - path[idxp]
    sgn = np.sign(np.einsum("ij,ij->i", c.N, outward).sum())
    if sgn < 0:
        c.N = -c.N
        c.F = c.F[:, ::-1]
    out = [g]
    if caps:
        for k, t in ((0, -T[0]), (K - 1, T[-1])):
            a = TAU * np.arange(seg) / seg
            ring = path[k] + rad[k] * (np.cos(a)[:, None] * Nn[k] + np.sin(a)[:, None] * B[k])
            out.append(polygon(ring, mat, normal=t))
    res = Geo()
    for o in out:
        res.add(o)
    return res


def cylinder(p0, p1, r0, r1=None, seg=16, mat="steel", caps=True):
    r1 = r0 if r1 is None else r1
    p0 = np.asarray(p0, dtype=np.float64)
    p1 = np.asarray(p1, dtype=np.float64)
    return tube(np.stack([p0, p1]), np.array([r0, r1]), seg, mat, caps)


def catmull(pts, per=6):
    """Catmull-Rom smoothing of a polyline (open)."""
    P = np.asarray(pts, dtype=np.float64)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def torus_ring(y, R, r, nu=48, nv=10, mat="steel", cx=0.0, cz=0.0):
    """Horizontal torus (ring) at height y: major radius R, minor radius r."""
    def pos(U, row):
        v = TAU * row
        rr = R + r * math.cos(v)
        a = TAU * U
        return np.stack([cx + rr * np.cos(a), np.full_like(U, y + r * math.sin(v)), cz - rr * np.sin(a)], axis=1)
    rows = list(np.linspace(0, 1, nv + 1))
    return surface(pos, rows, nu, mat=mat, radial_axis=(cx, cz), ref_row=0)


# ------------------------------------------------------------------------------------ transforms

def mat_t(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def mat_ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def mat_rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def mat_rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def frame_between(p0, p1, up=(0, 1, 0)):
    """Matrix placing +Y along p0->p1 (used to orient cylinders built on the y axis)."""
    d = Vector(p1) - Vector(p0)
    q = Vector((0, 1, 0)).rotation_difference(d.normalized())
    return Matrix.Translation(Vector(p0)) @ q.to_matrix().to_4x4()


# ------------------------------------------------------------------------------------ Blender

_MAT_CACHE = {}


def get_material(name, rgba=(0.5, 0.5, 0.5, 1.0), metallic=0.0, roughness=0.5):
    m = _MAT_CACHE.get(name) or bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = rgba
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = roughness
    _MAT_CACHE[name] = m
    return m


def to_mesh(geo, name):
    """Create a Blender mesh datablock from a Geo. One material slot per distinct chunk material."""
    mats = []
    for c in geo.chunks:
        if c.mat not in mats:
            mats.append(c.mat)
    Ps, Ns, UVs, faces, mi = [], [], [], [], []
    off = 0
    for c in geo.chunks:
        Ps.append(c.P)
        Ns.append(c.N)
        UV = c.UV
        if not np.any(UV):   # flat helper primitives carry no UVs: planar projection along the dominant normal axis
            ax = np.argmax(np.abs(c.N), axis=1)
            u = np.where(ax == 0, c.P[:, 2], c.P[:, 0])
            v = np.where(ax == 1, c.P[:, 2], c.P[:, 1])
            UV = np.stack([u, v], axis=1) * 0.25
        UVs.append(UV)
        F = c.F
        faces.append(F + off)
        mi.append(np.full(len(F), mats.index(c.mat), dtype=np.int32))
        off += len(c.P)
    if not Ps:
        return bpy.data.meshes.new(name)
    P = np.vstack(Ps)
    N = np.vstack(Ns)
    UV = np.vstack(UVs)
    # three-frame -> blender: (x, -z, y)
    Pb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)
    Nb = np.stack([N[:, 0], -N[:, 2], N[:, 1]], axis=1)
    quads = [f for f in faces if f.shape[1] == 4]
    tris = [f for f in faces if f.shape[1] == 3]
    # gather polygons as (loop indices) preserving per-face material
    poly_loops, poly_mat = [], []
    for f, m in zip(faces, mi):
        for row, mm in zip(f, m):
            poly_loops.append(row)
            poly_mat.append(mm)
    lens = np.array([len(r) for r in poly_loops], dtype=np.int32)
    loops = np.concatenate([np.asarray(r, dtype=np.int32) for r in poly_loops]) if poly_loops else np.zeros(0, np.int32)
    starts = np.concatenate([[0], np.cumsum(lens)[:-1]]).astype(np.int32)

    me = bpy.data.meshes.new(name)
    me.vertices.add(len(Pb))
    me.vertices.foreach_set("co", Pb.astype(np.float32).ravel())
    me.loops.add(len(loops))
    me.loops.foreach_set("vertex_index", loops)
    me.polygons.add(len(lens))
    me.polygons.foreach_set("loop_start", starts)
    me.polygons.foreach_set("loop_total", lens)
    me.polygons.foreach_set("material_index", np.asarray(poly_mat, dtype=np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(lens), dtype=bool))
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", UV[loops].astype(np.float32).ravel())
    me.normals_split_custom_set_from_vertices(Nb.tolist())
    for m in mats:
        me.materials.append(get_material(m))
    return me


def to_object(geo, name, collection=None, parent=None):
    me = to_mesh(geo, name)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector((loc[0], -loc[2], loc[1]))
    if parent is not None:
        ob.parent = parent
    return ob


def t_to_b(v):
    return Vector((v[0], -v[2], v[1]))
