"""Site structures from OSM (public/data/site.json): tank farm + deluge water tanks, GSE pipelines, Pad 1.

Tanks are grouped into a handful of unique meshes (class, diameter, length) that Blender links as duplicates; the
three.js side turns identical linked geometry into InstancedMesh. Everything is three.js frame, metres.

Tank classes (Blender material names): tank_lox, tank_ln2, tank_ch4, tank_water, tank_gas.
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
import pad_layout as L
from pad_layout import APRON_TOP, OLM_HALF as OLM_H, P1_AXIS, P1_C, P1_H, P1_YAW, SITE


def _v(x, y, z):
    return np.array([x, y, z], dtype=float)


# ------------------------------------------------------------------------------------------ OSM extraction
def oriented_rect(points):
    """(centre(2), long-axis unit(2), long, short) of the min-ish oriented box of a polygon via PCA."""
    P = np.array(points, dtype=float)
    c = P.mean(0)
    Q = P - c
    # principal axis by the longest hull-ish direction: use PCA on the vertices, refine by rotating +-15 deg
    w, V = np.linalg.eigh(np.cov(Q.T))
    best = None
    a0 = math.atan2(V[1, 1], V[0, 1])
    for da in np.linspace(-0.4, 0.4, 81):
        a = a0 + da
        d = np.array([math.cos(a), math.sin(a)])
        n = np.array([-d[1], d[0]])
        ext_d = np.ptp(Q @ d)
        ext_n = np.ptp(Q @ n)
        area = ext_d * ext_n
        if best is None or area < best[0]:
            best = (area, d, n, ext_d, ext_n, (Q @ d).min() + ext_d / 2, (Q @ n).min() + ext_n / 2)
    _, d, n, ed, en, oc_d, oc_n = best
    centre = c + d * oc_d + n * oc_n
    if ed < en:
        d, ed, en = n, en, ed
    return centre, d, ed, en


def klass(tags):
    c = (tags.get("content") or "").lower()
    if "oxygen" in c:
        return "tank_lox"
    if "methane" in c:
        return "tank_ch4"
    if "nitrogen" in c and "liquid" in c:
        return "tank_ln2"
    if "water" in c:
        return "tank_water"
    return "tank_gas"


H_SNAP = [(3.4, 26.0), (3.4, 39.0), (5.8, 48.4), (6.5, 50.2), (8.0, 31.3)]   # dia, length: the OSM series
V_SNAP = [1.6, 2.1, 2.7]


def extract_tanks():
    """List of dict(kind='h'|'v', cls, centre(x,z), yaw_deg, dia, length, height)."""
    out = []
    for f in SITE["features"]:
        if f["kind"] != "structure" or f["geom"] != "polygon":
            continue
        t = f["tags"]
        if t.get("man_made") != "storage_tank":
            continue
        centre, d, L, W = oriented_rect(f["points"])
        cls = klass(t)
        if L / max(W, 0.1) >= 2.4:
            dia, length = round(W, 1), round(L, 1)
            best = min(H_SNAP, key=lambda s: abs(s[0] - W) / s[0] + abs(s[1] - L) / s[1])
            if abs(best[0] - W) / best[0] + abs(best[1] - L) / best[1] < 0.2:
                dia, length = best
            if cls == "tank_gas" and dia > 5.0:
                cls = "tank_lox"       # untagged big bullets in the propellant farm
            yaw = math.degrees(math.atan2(-d[1], d[0]))
            out.append(dict(kind="h", cls=cls, centre=(float(centre[0]), float(centre[1])), yaw=yaw, dia=dia, length=length))
        else:
            dia = min(V_SNAP, key=lambda v: abs(v - max(min(L, W), 1.4)))
            hgt = float(t.get("height", 6.0))
            out.append(dict(kind="v", cls=cls, centre=(float(centre[0]), float(centre[1])), yaw=0.0, dia=dia, length=hgt))
    return out


def extract_pipelines():
    out = []
    for f in SITE["features"]:
        if f["kind"] == "structure" and f["geom"] == "line" and f["tags"].get("man_made") == "pipeline":
            out.append([tuple(p) for p in f["points"]])
    return out


# ------------------------------------------------------------------------------------------ tank meshes
def horizontal_tank(cls, dia, length):
    """Horizontal bullet on saddles, axis along +x, ground at y = 0 (tank bottom at 1.1 m)."""
    g = Geo()
    R = dia / 2
    cy = 1.1 + R
    L = length
    hh = R * 0.5             # 2:1 elliptical heads
    prof = [(0.0, -L / 2)]
    for t in np.linspace(0, math.pi / 2, 9)[1:]:
        prof.append((R * math.sin(t), -L / 2 + hh * (1 - math.cos(t))))
    for t in np.linspace(math.pi / 2, math.pi, 9)[1:]:
        prof.append((R * math.sin(t), L / 2 - hh * (1 + math.cos(t))))
    # profile now runs bottom -> top along the outer surface (axis = y). rotate onto +x afterwards.
    Rz = pg.rot_z(-90)
    tmp = Geo()
    pg.revolve(tmp, cls, prof, seg=32, crease_deg=50)
    g.extend(tmp, pg.M4(Rz, [0, cy, 0]))
    # ring stiffener bands
    bands = Geo()
    for x in np.arange(-L / 2 + 3.0, L / 2 - 2.9, 4.2):
        pg.tubes(bands, "tank_band", _v(0, x - 0.10, 0)[None], _v(0, x + 0.10, 0)[None], R + 0.06, seg=32, caps=False)
    g.extend(bands, pg.M4(Rz, [0, cy, 0]))
    # saddles: piers and steel straps
    for xs in (-0.32 * L, 0.0, 0.32 * L):
        pg.box(g, "concrete", [xs, 0.55, 0], [0.9, 1.1, 1.2 * dia * 0.8])
        pg.box(g, "concrete", [xs, 0.1, 0], [1.6, 0.2, dia * 1.15])
    # manways, relief stack, top piping
    for x, zz in ((L * 0.22, 0.0), (-L * 0.30, 0.0)):
        pg.tubes(g, "galv", _v(x, cy + R - 0.1, zz)[None], _v(x, cy + R + 0.4, zz)[None], 0.42, seg=12)
        pg.tubes(g, "galv", _v(x, cy + R + 0.4, zz)[None], _v(x, cy + R + 0.52, zz)[None], 0.5, seg=12)
    x = -L * 0.06
    pg.tubes(g, "galv", _v(x, cy + R - 0.1, 0)[None], _v(x, cy + R + 2.4, 0)[None], 0.13, seg=8)
    pg.tubes(g, "galv", _v(x, cy + R + 2.4, 0)[None], _v(x + 0.7, cy + R + 2.4, 0)[None], 0.13, seg=8)
    # end fill lines with elbows down to the ground
    for sg in (-1, 1):
        xe = sg * (L / 2 + 0.35)
        for zz in (-0.6, 0.6):
            pg.tubes(g, "galv", _v(xe, 0.2, zz)[None], _v(xe, cy - 0.4, zz)[None], 0.13, seg=8)
            pg.tubes(g, "galv", _v(xe - sg * 0.3, cy - 0.4, zz)[None], _v(xe, cy - 0.4, zz)[None], 0.13, seg=8)
            pg.spheres(g, "galv", [[xe, 0.2, zz]], 0.2, seg=8, rings=5)
    # ladder + toe rail along the top on big tanks
    if L > 25:
        pg.box(g, "grating", [0, cy + R + 0.05, 0], [L * 0.6, 0.05, 0.7])
        for sz in (-0.35, 0.35):
            pg.tubes(g, "galv", _v(-L * 0.3, cy + R + 0.05, sz)[None], _v(L * 0.3, cy + R + 0.05, sz)[None], 0.02, seg=4)
    return g


def vertical_tank(cls, dia, height):
    g = Geo()
    R = dia / 2
    y0 = 0.9
    H = max(height, 2.0)
    prof = [(0.0, y0), (R * 0.9, y0 + 0.06), (R, y0 + 0.3), (R, y0 + H - R * 0.3)]
    for t in np.linspace(0.0, math.pi / 2, 7)[1:]:
        prof.append((R * math.cos(t), y0 + H - R * 0.3 + R * 0.3 * math.sin(t) * 1.6))
    pg.revolve(g, cls, prof, seg=24, crease_deg=50)
    for sa, sb in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        pg.tubes(g, "galv", _v(sa * R * 0.72, 0, sb * R * 0.72)[None], _v(sa * R * 0.72, y0 + 0.4, sb * R * 0.72)[None], 0.08, seg=6)
    pg.tubes(g, "galv", _v(R * 0.6, y0 + H - 0.3, 0)[None], _v(R * 0.6, y0 + H + 0.8, 0)[None], 0.06, seg=6)
    return g


# ------------------------------------------------------------------------------------------ pipelines
def pipeline_geo(lines):
    g = Geo()
    for pts in lines:
        pts = [np.array(p) for p in pts]
        length = sum(np.linalg.norm(b - a) for a, b in zip(pts[:-1], pts[1:]))
        r = 0.34 if length > 40 else 0.14
        yy = 0.9 if length > 40 else 0.35
        for a, b in zip(pts[:-1], pts[1:]):
            pg.tubes(g, "pipe_insul" if length > 40 else "galv", _v(a[0], yy, a[1])[None], _v(b[0], yy, b[1])[None], r, seg=12)
            pg.spheres(g, "pipe_insul" if length > 40 else "galv", [[a[0], yy, a[1]], [b[0], yy, b[1]]], r, seg=12, rings=8)
            L = np.linalg.norm(b - a)
            m = int(L // 7.0) + 1
            for t in np.linspace(0, 1, m + 1)[:-1]:
                p = a + (b - a) * (t + 0.5 / (m + 1))
                pg.box(g, "concrete", [p[0], yy / 2 - 0.05, p[1]], [1.2, yy - r * 0.9, 0.6 if length > 40 else 0.4])
    return g


# GSE routing (all coordinates below marked LOCAL are pad-local and go through L.pad_to_world_xz; the object is built in
# the WORLD frame because the tank-farm ends are OSM world positions).
GSE_WORLD_TURN_X = -30.0            # world x where the three propellant lines turn from the tank farm run into the pad frame
GSE_LINES = [                       # (material, radius, height at the tank end, LOCAL riser x, LOCAL riser z, top height, LOCAL vertical x, LOCAL target z)
    ("pipe_insul", 0.36, 1.25, -19.0, -11.6, 21.4, -11.6, -3.2),
    ("pipe_insul", 0.30, 1.90, -20.5, -10.1, 22.2, -12.9, 3.2),
    ("galv", 0.16, 2.55, -22.0, -8.6, 20.55, -11.0, -8.6),
]
GSE_RUN_Z0 = -46.5                  # world z of the first propellant line on the long tank-farm run (1.6 m pitch)
GSE_RUN_D = 1.6
WATER_LOCAL = [(16.0, -66.0), (16.0, -14.4)]      # LOCAL path of the deluge water main (world start at the water tanks)
WATER_START_WORLD = (52.0, -44.5)
WATER_Y = 1.1


def gse_riser_positions():
    """World (x, z) of the three riser bases (colliders read this)."""
    return [L.pad_to_world_xz(ln[3], ln[4]) for ln in GSE_LINES]


def gse_geo():
    """Propellant + deluge feed lines from the tank farm / water tanks to the mount, on sleeper racks, plus the
    north-west GSE risers up to the deck for the booster QDs. The long run keeps to world x (the tank farm is OSM world
    geometry, and it clears the tower annex), turns at GSE_WORLD_TURN_X into the pad-local frame, comes round the
    west side of tower 2 (tower footings stand at the deck's cut NW corner) and rises at the deck's west flank."""
    import pad_olm as po
    g = Geo()
    W = L.pad_to_world_xz

    def run(mat, r, y, pts_world, y_end=None):
        for a, b in zip(pts_world[:-1], pts_world[1:]):
            pg.tubes(g, mat, _v(a[0], y, a[1])[None], _v(b[0], y, b[1])[None], r, seg=14)
        for p in pts_world[1:-1]:
            pg.spheres(g, mat, [[p[0], y, p[1]]], r * 1.02, seg=14, rings=8)

    for k, (mat, r, y, xr, zh, top, vx, tz) in enumerate(GSE_LINES):
        zw = GSE_RUN_Z0 - GSE_RUN_D * k
        jx, jz = L.world_to_pad_xz(GSE_WORLD_TURN_X, zw)
        pts = [(148.2, -40.0 - GSE_RUN_D * k), (128.0, zw), (GSE_WORLD_TURN_X, zw), W(jx, zh), W(xr, zh)]
        run(mat, r, y, pts)
        # riser to the deck height, turn east along the pad-local x, then onto the deck
        rx, rz = W(xr, zh)
        pg.tubes(g, mat, _v(rx, y, rz)[None], _v(rx, top, rz)[None], r, seg=14)
        for yy in np.arange(2.5, top - 1.0, 3.0):
            pg.box(g, "dark_steel", [rx, yy, rz], [r * 2 + 0.25, 0.12, r * 2 + 0.25], pg.rot_y(L.PAD_YAW))
        pg.spheres(g, mat, [[rx, top, rz]], r * 1.05, seg=12, rings=8)
        legs = [(xr, zh), (vx, zh)] + ([(vx, tz), (-10.5, tz)] if abs(tz - zh) > 0.1 else [(-10.5, zh)])
        wl = [W(*p) for p in legs]
        for a, b in zip(wl[:-1], wl[1:]):
            pg.tubes(g, mat, _v(a[0], top, a[1])[None], _v(b[0], top, b[1])[None], r, seg=12)
        for p in wl[1:-1]:
            pg.spheres(g, mat, [[p[0], top, p[1]]], r * 1.05, seg=12, rings=8)
        # posts on the deck under each leg
        for a, b in zip(legs[:-1], legs[1:]):
            n = max(int(math.hypot(b[0] - a[0], b[1] - a[1]) // 4.0), 1)
            for t in np.linspace(0, 1, n + 1):
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                if po.deck_inside(x, z, 0.6):
                    wx, wz = W(x, z)
                    pg.box(g, "dark_steel", [wx, (top + 20.0) / 2, wz], [0.25, top - 20.0 - r, 0.25], pg.rot_y(L.PAD_YAW))
    # H-frame sleepers every 9 m along the long run (world x aligned), under the three lines
    zc = GSE_RUN_Z0 - GSE_RUN_D
    for x in np.arange(GSE_WORLD_TURN_X + 2.0, 128.0, 9.0):
        pg.box(g, "galv", [x, 1.4, zc - 2.3], [0.25, 2.8, 0.25])
        pg.box(g, "galv", [x, 1.4, zc + 2.3], [0.25, 2.8, 0.25])
        pg.box(g, "galv", [x, 2.75, zc], [0.3, 0.2, 4.9])
    # the deluge water main: tank end (world) -> local +z along x = 18.5 to the north catwalk end
    w0 = WATER_START_WORLD
    wp = [w0, W(*WATER_LOCAL[0])] + [W(*p) for p in WATER_LOCAL[1:]]
    run("stainless", 0.55, WATER_Y, wp)
    return g


# ------------------------------------------------------------------------------------------ Pad 1 (low detail)
def pad1_mount():
    """Decommissioned Pad 1 launch mount, low detail: ring table on six legs (the original 'donut' + deluge plate)."""
    g = Geo()
    ax, az = P1_AXIS[0], P1_AXIS[2]
    top = 20.0
    R_out, R_in = 15.0, 5.5
    pg.revolve(g, "olm_steel", [(R_in, top), (R_out - 1.0, top), (R_out, top - 1.0), (R_out, top - 4.4), (R_in + 1.5, top - 4.4), (R_in, top - 3.0), (R_in, top)][::-1],
               seg=64, cx=ax, cz=az)
    for k in range(6):
        a = math.radians(k * 60 + 15)
        x, z = ax + 12.0 * math.cos(a), az - 12.0 * math.sin(a)
        pg.box(g, "concrete", [x, 0.4, z], [3.4, 0.6, 3.4])
        pg.tubes(g, "olm_column", _v(x, 0.6, z)[None], _v(x, top - 4.4, z)[None], 1.15, seg=12)
    for k in range(20):
        a = math.radians(k * 18 + 9)
        x, z = ax + 6.4 * math.cos(a), az - 6.4 * math.sin(a)
        pg.box(g, "dark_steel", [x, top + 0.6, z], [1.2, 1.2, 1.5], pg.rot_y(math.degrees(a)))
    # concrete pad slab under the old mount (top at the apron level)
    pg.box(g, "apron", [ax, -0.63, az], [72.0, 1.5, 72.0])
    return g


def pad1_chopsticks():
    """Chopsticks docked low on the tower's east side (arms closed, parallel, pointing +x)."""
    g = Geo()
    from pad_chopsticks import truss_box
    y = 34.0
    for zs in (-6.0, 6.0):
        truss_box(g, "tower_paint", _v(P1_C[0] + 8.0, y, P1_C[2] + zs), _v(P1_C[0] + 26.0, y, P1_C[2] + zs), 3.2, 4.4, panels=6, cw=0.5, bw=0.22)
    truss_box(g, "tower_paint", _v(P1_C[0] + 7.0, y, P1_C[2] - 7.0), _v(P1_C[0] + 7.0, y, P1_C[2] + 7.0), 3.2, 4.4, panels=4, cw=0.5, bw=0.22)
    return g


def pad1_ground():
    g = Geo()
    # equipment enclosures and a fence-free ground pad around tower 1
    pg.box(g, "apron", [P1_C[0], -0.65, P1_C[2]], [30, 1.5, 30])   # top at 0.10: below the mount slab (0.12), no coplanar overlap
    return g
