"""Vectorised geometry kit for the Launch Pad 2 build (numpy, hard-edged by vertex duplication).

Everything is authored in the THREE.JS frame (x east, y up, z south, metres) and converted to Blender space
(x, -z, y) only when a Blender mesh is created, so the glTF exporter's +Y-up conversion lands the model back in
the three.js frame (same convention as lib.V and vehicle_geo).

A `Geo` is a bag of chunks. A chunk is (P, N, F, material-name). Blender material names double as roles in
three.js (src/pad/materials.ts). Hard edges are made by duplicating vertices (every box face owns its four
vertices), so Blender's own smooth shading yields exactly the authored normals; never call remove_doubles here.

Workhorses (all batched over n items, so a lattice tower with thousands of members costs a few numpy calls):
  boxes(g, mat, centres, sizes, R)         oriented boxes
  beams(g, mat, p0, p1, w, h)              rectangular members between two points
  tubes(g, mat, p0, p1, r, seg, caps)      round members between two points
  spheres / revolve / extrude_poly / ring_deck for the rest
"""
import math

import numpy as np

TAU = math.tau
UP = np.array([0.0, 1.0, 0.0])


def norm(a, eps=1e-12):
    n = np.linalg.norm(a, axis=-1, keepdims=True)
    return a / np.maximum(n, eps)


# ---------------------------------------------------------------------------------- matrices (three frame)
def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    # three.js rotation.y: x' = x c + z s ; z' = -x s + z c
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def M4(R=None, t=(0, 0, 0)):
    m = np.eye(4)
    if R is not None:
        m[:3, :3] = R
    m[:3, 3] = t
    return m


def frame_from_z(z, up_hint=UP):
    """Right-handed frames (n,3,3) whose COLUMNS are x,y,z axes; z = given directions (n,3)."""
    z = norm(np.atleast_2d(np.asarray(z, dtype=np.float64)))
    up = np.broadcast_to(np.asarray(up_hint, dtype=np.float64), z.shape).copy()
    par = np.abs(np.einsum("ij,ij->i", z, up)) > 0.98
    up[par] = np.array([1.0, 0.0, 0.0])
    x = norm(np.cross(up, z))
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=2)


# ---------------------------------------------------------------------------------- templates
def _cube_template():
    P, N, F = [], [], []
    for axis in range(3):
        for sgn in (-1, 1):
            n = np.zeros(3)
            n[axis] = sgn
            u = np.zeros(3)
            u[(axis + 1) % 3] = 1
            v = np.cross(n, u)
            base = len(P)
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P.append(0.5 * (n + a * u + b * v))
                N.append(n)
            F += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    P, N, F = np.array(P), np.array(N), np.array(F)
    # make sure the winding agrees with the normal
    for i, f in enumerate(F):
        e = np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]])
        if np.dot(e, N[f[0]]) < 0:
            F[i] = f[::-1]
    return P, N, F


_CUBE = _cube_template()

_CYL_CACHE = {}


def _cyl_template(seg, caps, smooth=True):
    key = (seg, caps, smooth)
    if key in _CYL_CACHE:
        return _CYL_CACHE[key]
    P, N, F = [], [], []
    ang = TAU * np.arange(seg) / seg
    c, s = np.cos(ang), np.sin(ang)
    for k, z in enumerate((-0.5, 0.5)):
        for i in range(seg):
            P.append((c[i], s[i], z))
            N.append((c[i], s[i], 0.0))
    for i in range(seg):
        j = (i + 1) % seg
        F += [(i, j, seg + j), (i, seg + j, seg + i)]
    if not smooth:  # faceted: duplicate per face
        P2, N2, F2 = [], [], []
        for i in range(seg):
            j = (i + 1) % seg
            nm = np.array([math.cos(math.pi * (2 * i + 1) / seg), math.sin(math.pi * (2 * i + 1) / seg), 0])
            b = len(P2)
            P2 += [P[i], P[j], P[seg + j], P[seg + i]]
            N2 += [nm] * 4
            F2 += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
        P, N, F = P2, N2, F2
    if caps:
        for z, nz in ((-0.5, -1.0), (0.5, 1.0)):
            b = len(P)
            P.append((0, 0, z))
            N.append((0, 0, nz))
            for i in range(seg):
                P.append((c[i], s[i], z))
                N.append((0, 0, nz))
            for i in range(seg):
                j = (i + 1) % seg
                F.append((b, b + 1 + j, b + 1 + i) if nz > 0 else (b, b + 1 + i, b + 1 + j))
    P, N, F = np.array(P, dtype=np.float64), np.array(N, dtype=np.float64), np.array(F, dtype=np.int64)
    # winding vs normal (only for the side wall triangles where it matters)
    for i, f in enumerate(F):
        e = np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]])
        if np.dot(e, N[f[0]] + N[f[1]] + N[f[2]]) < 0:
            F[i] = f[::-1]
    _CYL_CACHE[key] = (P, N, F)
    return _CYL_CACHE[key]


# ---------------------------------------------------------------------------------- Geo
class Geo:
    def __init__(self):
        self.chunks = []          # (P, N, F, mat)

    def add(self, mat, P, N, F):
        if len(F):
            self.chunks.append((np.asarray(P, dtype=np.float64), np.asarray(N, dtype=np.float64),
                                np.asarray(F, dtype=np.int64), mat))
        return self

    def extend(self, other, M=None, mat=None):
        """Append another Geo, optionally transformed by a 4x4 (rotation+translation) and/or re-materialled."""
        for P, N, F, m in other.chunks:
            if M is not None:
                R = M[:3, :3]
                P = P @ R.T + M[:3, 3]
                N = norm(N @ np.linalg.inv(R).T)
                if np.linalg.det(R) < 0:
                    F = F[:, ::-1]
            self.chunks.append((P, N, F, mat or m))
        return self

    def mat_all(self, mat):
        self.chunks = [(P, N, F, mat) for P, N, F, _ in self.chunks]
        return self

    def tri_count(self):
        return int(sum(len(F) for _, _, F, _ in self.chunks))

    def merged(self):
        """dict mat -> (P, N, F) concatenated."""
        by = {}
        for P, N, F, m in self.chunks:
            by.setdefault(m, []).append((P, N, F))
        out = {}
        for m, lst in by.items():
            off, Ps, Ns, Fs = 0, [], [], []
            for P, N, F in lst:
                Ps.append(P)
                Ns.append(N)
                Fs.append(F + off)
                off += len(P)
            out[m] = (np.vstack(Ps), np.vstack(Ns), np.vstack(Fs))
        return out

    def bounds(self):
        allp = np.vstack([c[0] for c in self.chunks])
        return allp.min(0), allp.max(0)


def _place(tpl, C, R, S):
    """Instantiate template (P,N,F) n times: P' = (P*S) R^T + C. C (n,3), R (n,3,3) or None, S (n,3)."""
    P, N, F = tpl
    n = len(C)
    Pn = P[None, :, :] * S[:, None, :]
    if R is not None:
        Pn = np.einsum("nij,nvj->nvi", R, Pn)
        Nn = np.einsum("nij,vj->nvi", R, N)
    else:
        Nn = np.broadcast_to(N, (n,) + N.shape)
    Pn = Pn + C[:, None, :]
    V = len(P)
    Fn = (F[None, :, :] + (np.arange(n) * V)[:, None, None]).reshape(-1, 3)
    return Pn.reshape(-1, 3), np.ascontiguousarray(Nn).reshape(-1, 3), Fn


def _v3(a, n):
    a = np.asarray(a, dtype=np.float64)
    if a.ndim == 0:
        a = np.full((n, 3), float(a))
    elif a.ndim == 1:
        a = np.broadcast_to(a, (n, 3)).copy()
    return a


def boxes(g, mat, centres, sizes, R=None):
    """Oriented boxes. centres (n,3); sizes (3,) or (n,3) FULL extents; R optional (n,3,3) or (3,3) column bases."""
    C = np.atleast_2d(np.asarray(centres, dtype=np.float64))
    n = len(C)
    S = _v3(sizes, n)
    if R is not None:
        R = np.asarray(R, dtype=np.float64)
        if R.ndim == 2:
            R = np.broadcast_to(R, (n, 3, 3))
    g.add(mat, *_place(_CUBE, C, R, S))
    return g


def box(g, mat, centre, size, R=None):
    return boxes(g, mat, [centre], size, R)


def box_min_max(g, mat, lo, hi):
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    return box(g, mat, (lo + hi) / 2, hi - lo)


def beams(g, mat, p0, p1, w, h=None, up=UP, extend=0.0):
    """Rectangular-section members. p0,p1 (n,3). Cross-section w (local x) by h (local y); x = up x dir."""
    p0 = np.atleast_2d(np.asarray(p0, dtype=np.float64))
    p1 = np.atleast_2d(np.asarray(p1, dtype=np.float64))
    n = len(p0)
    d = p1 - p0
    L = np.linalg.norm(d, axis=1)
    keep = L > 1e-6
    p0, p1, d, L = p0[keep], p1[keep], d[keep], L[keep]
    n = len(p0)
    if n == 0:
        return g
    h = w if h is None else h
    W = np.broadcast_to(np.asarray(w, dtype=np.float64), (keep.size,))[keep]
    H = np.broadcast_to(np.asarray(h, dtype=np.float64), (keep.size,))[keep]
    R = frame_from_z(d, up)
    S = np.stack([W, H, L + 2 * extend], axis=1)
    g.add(mat, *_place(_CUBE, (p0 + p1) / 2, R, S))
    return g


def tubes(g, mat, p0, p1, r, seg=8, caps=True, smooth=True):
    p0 = np.atleast_2d(np.asarray(p0, dtype=np.float64))
    p1 = np.atleast_2d(np.asarray(p1, dtype=np.float64))
    d = p1 - p0
    L = np.linalg.norm(d, axis=1)
    keep = L > 1e-6
    p0, p1, d, L = p0[keep], p1[keep], d[keep], L[keep]
    n = len(p0)
    if n == 0:
        return g
    r = np.broadcast_to(np.asarray(r, dtype=np.float64), (keep.size,))[keep]
    R = frame_from_z(d)
    S = np.stack([r, r, L], axis=1)
    g.add(mat, *_place(_cyl_template(seg, caps, smooth), (p0 + p1) / 2, R, S))
    return g


def cyl_y(g, mat, centres, r, h, seg=12, caps=True, smooth=True, y_is_base=True):
    """Vertical cylinders; centres (n,3) are the BASE centres (or middle if y_is_base False)."""
    C = np.atleast_2d(np.asarray(centres, dtype=np.float64))
    n = len(C)
    r = np.broadcast_to(np.asarray(r, dtype=np.float64), (n,))
    h = np.broadcast_to(np.asarray(h, dtype=np.float64), (n,))
    p0 = C.copy()
    p1 = C.copy()
    if y_is_base:
        p1[:, 1] += h
    else:
        p0[:, 1] -= h / 2
        p1[:, 1] += h / 2
    return tubes(g, mat, p0, p1, r, seg, caps, smooth)


_SPH_CACHE = {}


def _sphere_template(seg, rings):
    key = (seg, rings)
    if key in _SPH_CACHE:
        return _SPH_CACHE[key]
    P, F = [], []
    for j in range(rings + 1):
        th = math.pi * j / rings
        for i in range(seg):
            ph = TAU * i / seg
            P.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    for j in range(rings):
        for i in range(seg):
            k = (i + 1) % seg
            a, b, c, d = j * seg + i, j * seg + k, (j + 1) * seg + k, (j + 1) * seg + i
            F += [(a, c, b), (a, d, c)] if j > 0 and j < rings - 1 else ([(a, d, c)] if j == 0 else [(a, c, b)])
    P = np.array(P)
    _SPH_CACHE[key] = (P, P.copy(), np.array(F, dtype=np.int64))
    return _SPH_CACHE[key]


def spheres(g, mat, centres, r, seg=10, rings=6):
    C = np.atleast_2d(np.asarray(centres, dtype=np.float64))
    n = len(C)
    r = np.broadcast_to(np.asarray(r, dtype=np.float64), (n,))
    S = np.stack([r, r, r], axis=1)
    g.add(mat, *_place(_sphere_template(seg, rings), C, None, S))
    return g


def revolve(g, mat, prof, seg=32, cx=0.0, cz=0.0, crease_deg=35.0, phase=0.0, R=None, t=None, flip=False):
    """Surface of revolution about the vertical axis through (cx, cz). prof = [(r, y), ...] traversed bottom->top
    on the OUTER surface (normal = (dy, -dr)). Adjacent segments whose normals differ by more than crease_deg
    get a hard edge. Optional rotation R (3,3) about the origin and translation t applied afterwards."""
    prof = np.asarray(prof, dtype=np.float64)
    m = len(prof)
    seg_n = []
    for k in range(m - 1):
        dr, dy = prof[k + 1, 0] - prof[k, 0], prof[k + 1, 1] - prof[k, 1]
        nn = np.array([dy, -dr])
        nn /= max(np.linalg.norm(nn), 1e-12)
        seg_n.append(nn)
    seg_n = np.array(seg_n)
    rows, seg_rows = [], []
    prev_end = None
    for k in range(m - 1):
        if k > 0 and float(np.dot(seg_n[k - 1], seg_n[k])) > math.cos(math.radians(crease_deg)):
            a = prev_end
            avg = seg_n[k - 1] + seg_n[k]
            avg /= max(np.linalg.norm(avg), 1e-12)
            rows[a][2:4] = avg
        else:
            rows.append([prof[k, 0], prof[k, 1], seg_n[k][0], seg_n[k][1]])
            a = len(rows) - 1
        rows.append([prof[k + 1, 0], prof[k + 1, 1], seg_n[k][0], seg_n[k][1]])
        b = len(rows) - 1
        seg_rows.append((a, b))
        prev_end = b
    rows = np.array(rows)
    nr = len(rows)
    ang = TAU * np.arange(seg) / seg + phase
    c, s = np.cos(ang), np.sin(ang)
    P = np.zeros((nr, seg, 3))
    N = np.zeros((nr, seg, 3))
    P[:, :, 0] = rows[:, 0:1] * c
    P[:, :, 1] = rows[:, 1:2]
    P[:, :, 2] = -rows[:, 0:1] * s
    N[:, :, 0] = rows[:, 2:3] * c
    N[:, :, 1] = rows[:, 3:4]
    N[:, :, 2] = -rows[:, 2:3] * s
    F = []
    for (a, b) in seg_rows:
        if abs(rows[a, 0]) < 1e-9 and abs(rows[b, 0]) < 1e-9:
            continue
        for i in range(seg):
            j = (i + 1) % seg
            va, vb, vc, vd = a * seg + i, a * seg + j, b * seg + j, b * seg + i
            # counter-clockwise seen from outside
            if abs(rows[a, 0]) < 1e-9:
                F.append((va, vc, vd) if not flip else (va, vd, vc))
            elif abs(rows[b, 0]) < 1e-9:
                F.append((va, vb, vc) if not flip else (va, vc, vb))
            else:
                F += ([(va, vb, vc), (va, vc, vd)] if not flip else [(va, vc, vb), (va, vd, vc)])
    Pf, Nf = P.reshape(-1, 3), N.reshape(-1, 3)
    F = np.array(F, dtype=np.int64)
    # fix winding against normals
    e = np.cross(Pf[F[:, 1]] - Pf[F[:, 0]], Pf[F[:, 2]] - Pf[F[:, 0]])
    bad = np.einsum("ij,ij->i", e, Nf[F[:, 0]] + Nf[F[:, 1]] + Nf[F[:, 2]]) < 0
    F[bad] = F[bad][:, ::-1]
    Pf = Pf + np.array([cx, 0, cz])
    if R is not None:
        Pf = Pf @ np.asarray(R).T
        Nf = Nf @ np.asarray(R).T
    if t is not None:
        Pf = Pf + np.asarray(t)
    g.add(mat, Pf, Nf, F)
    return g


def ear_clip(pts):
    """Triangulate a simple polygon (list of (x,z), any winding). Returns index triples, CCW in (x,z)."""
    pts = [tuple(p) for p in pts]
    n = len(pts)
    idx = list(range(n))
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    if area < 0:
        idx.reverse()
    tris = []

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= -1e-12 and cross(b, c, p) >= -1e-12 and cross(c, a, p) >= -1e-12

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        ear = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            ear = True
            break
        if not ear:
            break
    if len(idx) == 3:
        tris.append((idx[0], idx[1], idx[2]))
    return tris


def extrude_poly(g, mat, pts, y0, y1, caps=True, sides=True, side_smooth=False):
    """Vertical prism from plan polygon pts [(x,z)] between y0 and y1. Caps triangulated by ear clipping."""
    pts = [tuple(p) for p in pts]
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    ccw = area > 0   # in (x,z)
    P, N, F = [], [], []
    if caps:
        tri = ear_clip(pts)
        for y, ny in ((y1, 1.0), (y0, -1.0)):
            b = len(P)
            for (x, z) in pts:
                P.append((x, y, z))
                N.append((0, ny, 0))
            for (i, j, k) in tri:
                # (x,z) CCW seen from +y looking down means clockwise in three's handed frame; test by normal
                a, bb, c = np.array(P[b + i]), np.array(P[b + j]), np.array(P[b + k])
                if np.dot(np.cross(bb - a, c - a), (0, ny, 0)) < 0:
                    F.append((b + i, b + k, b + j))
                else:
                    F.append((b + i, b + j, b + k))
    if sides:
        for i in range(n):
            j = (i + 1) % n
            (xa, za), (xb, zb) = pts[i], pts[j]
            d = np.array([xb - xa, 0, zb - za])
            L = np.linalg.norm(d)
            if L < 1e-9:
                continue
            nm = np.array([d[2], 0, -d[0]]) / L
            if not ccw:
                nm = -nm
            # orient the normal outward: in (x,z) CCW, outward is to the right of the edge direction = (dz, -dx)
            b = len(P)
            P += [(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)]
            N += [tuple(nm)] * 4
            F += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    P, N, F = np.array(P), np.array(N), np.array(F, dtype=np.int64)
    e = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    bad = np.einsum("ij,ij->i", e, N[F[:, 0]]) < 0
    F[bad] = F[bad][:, ::-1]
    g.add(mat, P, N, F)
    return g


def extrude_profile(g, mat, pts, z0, z1, smooth_deg=30.0, cap0=True, cap1=True):
    """Extrude a profile polygon pts [(x,y)] along z from z0 to z1. Side normals are smoothed across edges that
    bend less than smooth_deg; caps are ear-clipped."""
    pts = np.asarray(pts, dtype=np.float64)
    n = len(pts)
    area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    ccw = area > 0
    e = np.roll(pts, -1, axis=0) - pts
    L = np.linalg.norm(e, axis=1, keepdims=True)
    t = e / np.maximum(L, 1e-12)
    en = np.stack([t[:, 1], -t[:, 0]], axis=1)          # right-hand normal = outward for CCW
    if not ccw:
        en = -en
    P, N, F = [], [], []
    cs = math.cos(math.radians(smooth_deg))
    for i in range(n):
        j = (i + 1) % n
        if L[i, 0] < 1e-9:
            continue
        ip = (i - 1) % n
        jn = (j + 1) % n
        na = en[i].copy()
        nb = en[i].copy()
        if np.dot(en[ip], en[i]) > cs:
            na = en[ip] + en[i]
        if np.dot(en[i], en[jn]) > cs:
            nb = en[i] + en[jn]
        na /= max(np.linalg.norm(na), 1e-12)
        nb /= max(np.linalg.norm(nb), 1e-12)
        b = len(P)
        P += [(pts[i, 0], pts[i, 1], z0), (pts[j, 0], pts[j, 1], z0), (pts[j, 0], pts[j, 1], z1), (pts[i, 0], pts[i, 1], z1)]
        N += [(na[0], na[1], 0), (nb[0], nb[1], 0), (nb[0], nb[1], 0), (na[0], na[1], 0)]
        F += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    tri = ear_clip([tuple(p) for p in pts])
    for z, nz, on in ((z0, -1.0, cap0), (z1, 1.0, cap1)):
        if not on:
            continue
        b = len(P)
        for (x, y) in pts:
            P.append((x, y, z))
            N.append((0, 0, nz))
        for (i, j, k) in tri:
            F.append((b + i, b + j, b + k))
    P, N, F = np.array(P), np.array(N), np.array(F, dtype=np.int64)
    ee = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    bad = np.einsum("ij,ij->i", ee, N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]]) < 0
    F[bad] = F[bad][:, ::-1]
    g.add(mat, P, N, F)
    return g


def strip_between(g, mat, loopA, loopB, closed=True, ref=None):
    """Quad strip between two equal-length 3D loops (used for the deck top with a circular hole)."""
    A, B = np.asarray(loopA, float), np.asarray(loopB, float)
    n = len(A)
    P, N, F = [], [], []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        j = (i + 1) % n
        b = len(P)
        P += [A[i], A[j], B[j], B[i]]
        nm = np.cross(A[j] - A[i], B[i] - A[i])
        if np.linalg.norm(nm) < 1e-12:
            nm = np.cross(A[j] - A[i], B[j] - A[j])
        nm = nm / max(np.linalg.norm(nm), 1e-12)
        if ref is not None and np.dot(nm, ref) < 0:
            nm = -nm
        N += [nm] * 4
        F += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    g.add(mat, np.array(P), np.array(N), np.array(F, dtype=np.int64))
    fix_up_normals(g)
    return g


def fix_up_normals(g, y_sign=1.0):
    """Flip winding of any triangle whose geometric normal disagrees with its vertex normals."""
    out = []
    for P, N, F, m in g.chunks:
        e = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
        bad = np.einsum("ij,ij->i", e, N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]]) < 0
        F = F.copy()
        F[bad] = F[bad][:, ::-1]
        out.append((P, N, F, m))
    g.chunks = out
    return g


# ---------------------------------------------------------------------------------- Blender conversion
def to_blender_mesh(geo, name, bpy, mat_getter):
    """Create a Blender mesh from a Geo (one material slot per distinct material name)."""
    merged = geo.merged()
    mats = list(merged.keys())
    Ps, Fs, Mi = [], [], []
    off = 0
    for mi, m in enumerate(mats):
        P, N, F = merged[m]
        Ps.append(P)
        Fs.append(F + off)
        Mi.append(np.full(len(F), mi, dtype=np.int32))
        off += len(P)
    me = bpy.data.meshes.new(name)
    if not Ps:
        return me
    P = np.vstack(Ps)
    F = np.vstack(Fs)
    Mi = np.concatenate(Mi)
    Pb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)   # three -> blender
    me.vertices.add(len(Pb))
    me.vertices.foreach_set("co", Pb.astype(np.float32).ravel())
    nt = len(F)
    me.loops.add(nt * 3)
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.add(nt)
    me.polygons.foreach_set("loop_start", (np.arange(nt) * 3).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(nt, 3, dtype=np.int32))
    me.polygons.foreach_set("material_index", Mi)
    me.polygons.foreach_set("use_smooth", np.ones(nt, dtype=bool))
    me.update(calc_edges=True)
    for m in mats:
        me.materials.append(mat_getter(m))
    return me
