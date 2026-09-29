"""Flame trench (east-west), double-sided water-cooled steel diverter, apron slabs, trench guard fence, light poles.

World frame (three.js). Trench: 60 m full-depth floor at y = -8, sloped end ramps to ground at |x| = 40 (open to the
east and west), 25 m wide, concrete walls 3.5 m thick out to z = +-16 (the env terrain cutout, scene-config.ts
TRENCH_CUTOUT), stainless lining on the lower walls and floor near the centre, deluge headers along the walls.
The diverter ridge runs north-south with its apex near anchors.plumeImpact (0, -4, 0); the exhaust splits E/W.

Returns dict name -> Geo: trench, diverter, apron, trench_pipes, fence, lights
Materials: concrete, concrete_scorch, stainless, diverter, grating, galv, dark_steel.
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
from pad_layout import APRON, APRON_POLY, APRON_TOP, TR_FLOOR, TR_HX, TR_HZ, TR_WALL_OUT, TRENCH_CUT

FL = TR_FLOOR
DIV_HX = 13.5            # diverter half length along x
DIV_HZ = 7.6             # diverter half width along z
DIV_APEX = -3.4          # apex height (nose)


def _v(x, y, z):
    return np.array([x, y, z], dtype=float)


def diverter_profile(x):
    """Concave 'ski-jump' bucket: nose at x = 0, sweeping down to the floor tangentially at |x| = DIV_HX."""
    a = np.sqrt(x * x + 0.30 ** 2) - 0.30
    s = np.clip(1.0 - a / DIV_HX, 0.0, 1.0)
    return FL + (DIV_APEX - FL) * s ** 2.3


def trench_geo():
    g = Geo()
    hx, hz = TRENCH_CUT["halfX"], TRENCH_CUT["halfZ"]
    # ---- floor + end ramps (profile in x,y extruded across the trench width) ----
    prof = [(-hx, APRON_TOP), (-TR_HX, FL), (TR_HX, FL), (hx, APRON_TOP), (hx, FL - 1.5), (-hx, FL - 1.5)]
    pg.extrude_profile(g, "concrete_scorch", prof, -TR_HZ, TR_HZ, smooth_deg=5)
    # ---- wall blocks (collar): 3.5 m thick from the trench face to the terrain cutout ----
    for s in (-1, 1):
        zc = s * (TR_HZ + TR_WALL_OUT) / 2
        pg.box(g, "concrete_scorch", [0, (APRON_TOP + FL - 1.5) / 2, zc], [2 * hx, APRON_TOP - FL + 1.5, TR_WALL_OUT - TR_HZ])
        # steel edge angle along the lip and pilasters every 7.5 m on the trench face
        pg.beams(g, "dark_steel", _v(-hx, APRON_TOP + 0.05, s * (TR_HZ + 0.12))[None], _v(hx, APRON_TOP + 0.05, s * (TR_HZ + 0.12))[None], 0.3, 0.12)
    # pilasters (only where the wall is deep enough): expansion-joint relief
    for s in (-1, 1):
        for x in np.arange(-TR_HX + 2.0, TR_HX - 1.9, 7.5):
            pg.box(g, "concrete_scorch", [x, (APRON_TOP + FL) / 2 + 0.0, s * (TR_HZ - 0.2)], [0.9, APRON_TOP - FL, 0.4])
    # ---- stainless lining on the lower walls and a central floor plate field ----
    for s in (-1, 1):
        zf = s * (TR_HZ - 0.04)
        ncol = 14
        xs = np.linspace(-21, 21, ncol + 1)
        for a, b in zip(xs[:-1], xs[1:]):
            pg.box(g, "stainless", [(a + b) / 2, (FL + 0.4 + (-3.0)) / 2 + 0.0, zf], [b - a - 0.05, -3.0 - FL - 0.4, 0.08])
        # welded seam ribs and bolt rows
        for x in xs:
            pg.box(g, "stainless", [x, (FL + -3.0) / 2, zf - s * 0.02], [0.14, -3.0 - FL, 0.13])
        for yb in (FL + 1.2, FL + 2.6, FL + 3.8):
            pg.box(g, "stainless", [0, yb, zf - s * 0.02], [42.0, 0.12, 0.12])
    fx = np.linspace(-16.0, 16.0, 17)
    for a, b in zip(fx[:-1], fx[1:]):
        pg.box(g, "stainless", [(a + b) / 2, FL + 0.03, 0], [b - a - 0.05, 0.06, 2 * TR_HZ - 3.0])
    # drain channels along the floor edges (grating over recessed channel)
    for s in (-1, 1):
        pg.box(g, "grating", [0, FL + 0.05, s * (TR_HZ - 0.7)], [2 * TR_HX - 6, 0.06, 1.0])
    return g


def diverter_geo():
    g = Geo()
    xs = np.concatenate([np.linspace(-DIV_HX, -1.5, 34), np.linspace(-1.5, 1.5, 17)[1:-1], np.linspace(1.5, DIV_HX, 34)])
    top = [(float(x), float(diverter_profile(x))) for x in xs]
    poly = top + [(DIV_HX, FL - 0.4), (-DIV_HX, FL - 0.4)]
    pg.extrude_profile(g, "diverter", poly, -DIV_HZ, DIV_HZ, smooth_deg=25)
    # stiffening ribs on both end faces, following the curve; each rib is a slim solid slab
    for zs in (-DIV_HZ, DIV_HZ):
        sgn = 1.0 if zs > 0 else -1.0
        for xr in np.arange(-DIV_HX + 1.0, DIV_HX, 1.9):
            yt = float(diverter_profile(xr))
            pg.box(g, "diverter", [xr, (yt + FL) / 2, zs + sgn * 0.12], [0.22, yt - FL - 0.5, 0.24])
        # horizontal flange along the top edge
        pts = np.array(top)
        p0 = np.stack([pts[:-1, 0], pts[:-1, 1] + 0.02, np.full(len(pts) - 1, zs + sgn * 0.08)], axis=1)
        p1 = np.stack([pts[1:, 0], pts[1:, 1] + 0.02, np.full(len(pts) - 1, zs + sgn * 0.08)], axis=1)
        pg.beams(g, "diverter", p0, p1, 0.16, 0.34, up=_v(0, 0, 1))
    # cooling tube rows lying on the working faces
    for x0 in (2.2, 4.4, 6.6, 8.8, 10.8):
        for s in (-1, 1):
            xx = s * x0
            yy = float(diverter_profile(xx)) + 0.09
            pg.tubes(g, "stainless", _v(xx, yy, -DIV_HZ + 0.6)[None], _v(xx, yy, DIV_HZ - 0.6)[None], 0.085, seg=6)
    # apex manifold: two water headers along the nose with spray stubs
    for s in (-1, 1):
        pg.tubes(g, "stainless", _v(s * 0.75, DIV_APEX + 0.05, -DIV_HZ - 0.3)[None], _v(s * 0.75, DIV_APEX + 0.05, DIV_HZ + 0.3)[None], 0.22, seg=10)
    zs = np.linspace(-DIV_HZ + 0.6, DIV_HZ - 0.6, 15)
    a = np.stack([np.zeros_like(zs) + 0.0, np.full_like(zs, DIV_APEX + 0.15), zs], axis=1)
    pg.tubes(g, "stainless", a, a + _v(0, 0.35, 0), 0.06, seg=6)
    # anchor lugs / hold-downs to the floor slab on both sides
    for s in (-1, 1):
        for zz in np.linspace(-6.5, 6.5, 6):
            pg.box(g, "dark_steel", [s * (DIV_HX + 0.6), FL + 0.25, zz], [1.2, 0.5, 0.7])
    return g


def pipes_geo():
    """Deluge headers along both trench walls with nozzle stubs aimed at the diverter, plus manifolds."""
    g = Geo()
    for s in (-1, 1):
        zp = s * (TR_HZ - 0.85)
        pg.tubes(g, "stainless", _v(-TR_HX + 1.5, -2.2, zp)[None], _v(TR_HX - 1.5, -2.2, zp)[None], 0.42, seg=16)
        pg.tubes(g, "stainless", _v(-TR_HX + 1.5, -5.0, zp)[None], _v(TR_HX - 1.5, -5.0, zp)[None], 0.30, seg=14)
        xs = np.arange(-TR_HX + 2.0, TR_HX - 1.9, 3.0)
        for yy in (-2.2, -5.0):
            for x in xs:
                pg.box(g, "dark_steel", [x, yy, s * (TR_HZ - 0.3)], [0.3, 0.35, 0.9])       # wall brackets
            # nozzle stubs pointing toward the trench axis
            a = np.stack([xs, np.full_like(xs, yy), np.full_like(xs, zp - s * 0.3)], axis=1)
            pg.tubes(g, "stainless", a, a + _v(0, 0, -s * 0.75), 0.07, seg=6)
        # flanges every 6 m
        for x in np.arange(-TR_HX + 4.5, TR_HX - 3, 6.0):
            pg.tubes(g, "stainless", _v(x, -2.2, zp)[None], _v(x + 0.18, -2.2, zp)[None], 0.55, seg=16)
    return g


def pond_hole():
    """OSM 'Pad-2 Deluge Runoff Pond' (world centre (-25, 57), ~35 m) now lies inside the slab: the slab is cut round it
    (polygon grown ~1.2 m for a curb) so the env module's pond water shows instead of being buried under the concrete.
    Returned in the PAD-LOCAL frame (the OSM points are world coordinates)."""
    import pad_layout as L
    pond = None
    for f in L.SITE["features"]:
        if f["kind"] == "water" and f["tags"].get("name") == "Pad-2 Deluge Runoff Pond":
            pond = [tuple(p) for p in f["points"]]
    if pond is None:
        return None
    pond = [L.world_to_pad_xz(x, z) for (x, z) in pond]
    if pond[0] == pond[-1]:
        pond = pond[:-1]
    cx = sum(p[0] for p in pond) / len(pond)
    cz = sum(p[1] for p in pond) / len(pond)
    grown = []
    for (x, z) in pond:
        d = math.hypot(x - cx, z - cz)
        k = (d + 1.2) / d
        grown.append((cx + (x - cx) * k, cz + (z - cz) * k))
    return grown


def _area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def slab_with_holes(g, mat, outer, holes, y0, y1):
    """Prism over a plan polygon with holes: caps tessellated by Blender (mathutils), side walls facing outward from the
    slab (out of the outer loop, into each hole)."""
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon
    loops = [list(outer)] + [list(h) for h in holes]
    flat = [pt for lp in loops for pt in lp]
    tris = tessellate_polygon([[Vector((x, z, 0.0)) for (x, z) in lp] for lp in loops])
    P, N, F = [], [], []
    for y, ny in ((y1, 1.0), (y0, -1.0)):
        b = len(P)
        for (x, z) in flat:
            P.append((x, y, z))
            N.append((0.0, ny, 0.0))
        for (i, j, k) in tris:
            a_, b_, c_ = np.array(P[b + i]), np.array(P[b + j]), np.array(P[b + k])
            if np.dot(np.cross(b_ - a_, c_ - a_), (0, ny, 0)) < 0:
                F.append((b + i, b + k, b + j))
            else:
                F.append((b + i, b + j, b + k))
    for li, lp in enumerate(loops):
        ccw = _area(lp) > 0
        for i in range(len(lp)):
            (xa, za), (xb, zb) = lp[i], lp[(i + 1) % len(lp)]
            d = np.array([xb - xa, 0.0, zb - za])
            Ln = np.linalg.norm(d)
            if Ln < 1e-9:
                continue
            nm = np.array([d[2], 0.0, -d[0]]) / Ln       # right of the edge = outward for a CCW loop in (x, z)
            if not ccw:
                nm = -nm
            if li > 0:
                nm = -nm                                # holes: the wall faces into the hole
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


def apron_geo():
    """The concrete pad plane (pad-local frame): APRON_POLY minus the trench cutout (the collar fills it) and minus the
    runoff pond. Top at APRON_TOP, 1.5 m thick (buried)."""
    g = Geo()
    hx, hz = TRENCH_CUT["halfX"], TRENCH_CUT["halfZ"]
    y0, y1 = -1.4, APRON_TOP
    cut = [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]
    holes = [cut]
    pond = pond_hole()
    if pond:
        holes.append(pond)
    slab_with_holes(g, "apron", list(APRON_POLY), holes, y0, y1)
    return g


FENCE_HX, FENCE_HZ = 48.0, 25.0
FENCE_GAP = (-31.0, -7.7)      # x range of the north fence removed where tower 2 and its annex stand on the fence line
FENCE_GAP_WATER = (14.5, 17.5)  # the deluge water main crosses the north fence here
FENCE_GAP_WEST = (-13.0, -7.0)  # the three propellant lines cross the west fence here (z range)


def fence_runs():
    """Fence segments (x0, z0, x1, z1) in the pad-local frame, with the gap for tower 2 in the north side."""
    fx, fz = FENCE_HX, FENCE_HZ
    g0, g1 = FENCE_GAP
    w0, w1 = FENCE_GAP_WATER
    q0, q1 = FENCE_GAP_WEST
    return [((-fx, -fz), (g0, -fz)), ((g1, -fz), (w0, -fz)), ((w1, -fz), (fx, -fz)), ((fx, -fz), (fx, fz)), ((fx, fz), (-fx, fz)),
            ((-fx, fz), (-fx, q1)), ((-fx, q0), (-fx, -fz))]


def fence_geo():
    """Guard fence round the trench / mount enclosure: posts, three rails, mid mesh panels."""
    g = Geo()
    for (x0, z0), (x1, z1) in fence_runs():
        L = math.hypot(x1 - x0, z1 - z0)
        m = max(int(L // 2.5), 1)
        ts = np.linspace(0, 1, m + 1)
        px = x0 + (x1 - x0) * ts
        pz = z0 + (z1 - z0) * ts
        base = np.stack([px, np.full_like(px, APRON_TOP), pz], axis=1)
        pg.tubes(g, "galv", base, base + _v(0, 1.3, 0), 0.04, seg=6)
        for hy in (1.3, 0.9, 0.45):
            pg.tubes(g, "galv", _v(x0, APRON_TOP + hy, z0)[None], _v(x1, APRON_TOP + hy, z1)[None], 0.025, seg=6)
    return g


LIGHT_POLES = [(-82.0, -60.0), (82.0, -60.0), (-82.0, 60.0), (82.0, 60.0), (-45.0, -62.0), (45.0, 62.0),
               (90.0, 150.0), (200.0, 190.0), (230.0, 90.0)]


def lights_geo():
    """Flood-light poles on the apron corners (15 m masts with lamp banks)."""
    g = Geo()
    for (x, z) in LIGHT_POLES:
        pg.tubes(g, "galv", _v(x, APRON_TOP, z)[None], _v(x, 6.0, z)[None], 0.28, seg=10)
        pg.tubes(g, "galv", _v(x, 6.0, z)[None], _v(x, 16.0, z)[None], 0.18, seg=10)
        pg.box(g, "concrete", [x, 0.4, z], [1.4, 0.8, 1.4])
        # lamp bank
        for k in range(-2, 3):
            pg.box(g, "dark_steel", [x + 0.6 * k, 16.5, z], [0.5, 0.35, 0.3])
        pg.box(g, "galv", [x, 16.1, z], [3.2, 0.12, 0.35])
    return g


def build():
    return dict(trench=trench_geo(), diverter=diverter_geo(), apron=apron_geo(), trench_pipes=pipes_geo(),
                fence=fence_geo(), lights=lights_geo())
