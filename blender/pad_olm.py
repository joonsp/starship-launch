"""Orbital Launch Mount (Pad 2 'quadratic' water-cooled deck): deck, opening, 20 hold-down clamps, deluge nozzle
ring, QD carriages, support columns with bracing, deluge risers and plumbing, access stairs.

World frame (three.js), origin = vehicle axis at ground. Deck top at OLM_TOP (20 m), footprint 34 m square,
central booster opening 10 m across left CLEAR.

Returns dict name -> Geo:  olm_deck, olm_details, olm_columns, olm_pipes, olm_stairs
Materials: olm_steel (water-cooled deck plate), dark_steel (clamps, machinery), olm_column (painted grey steel),
stainless (deluge plumbing, nozzles), galv, grating, concrete.
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
from pad_layout import HOLE_R, OLM_HALF, OLM_THICK, OLM_TOP, TR_WALL_OUT, APRON_TOP

CH = 3.6      # corner chamfer
BOT = OLM_TOP - OLM_THICK


def _v(x, y, z):
    return np.array([x, y, z], dtype=float)


NW_CUT = 4.0   # the tower-facing (-x,-z) corner is cut back along x + z = -(2 h - NW_CUT): tower 2's footings stand there


def deck_outline():
    """Chamfered-square plan polygon (x,z) in the PAD-LOCAL frame, counter-clockwise from the +x axis. The north-west
    corner (toward tower 2, which sits at pad-local (-17, -21) once the mount is rotated by PAD_YAW) is cut back."""
    h, c = OLM_HALF, CH
    return [(h, -(h - c)), (h, h - c), (h - c, h), (-(h - c), h), (-h, h - c), (-h, -NW_CUT), (-NW_CUT, -h), (h - c, -h)]


def inset_poly(poly, d):
    """Inward offset of a convex CCW polygon (x,z) (edge lines shifted by d, consecutive lines intersected)."""
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = np.array(poly[i], float), np.array(poly[(i + 1) % n], float)
        e = (b - a) / np.linalg.norm(b - a)
        nm = np.array([-e[1], e[0]])          # left normal = inward for the polygon's winding in (x,z) (checked below)
        lines.append((a + nm * d, e))
    out = []
    for i in range(n):
        p0, e0 = lines[i - 1]
        p1, e1 = lines[i]
        M = np.array([[e0[0], -e1[0]], [e0[1], -e1[1]]])
        t = np.linalg.solve(M, p1 - p0)
        out.append(tuple(p0 + e0 * t[0]))
    return out


def deck_inside(x, z, m=0.0):
    """Point inside the deck plan (positive margin = at least m metres from every edge). Convex test."""
    poly = deck_outline()
    n = len(poly)
    for i in range(n):
        a, b = np.array(poly[i]), np.array(poly[(i + 1) % n])
        e = b - a
        cr = e[0] * (z - a[1]) - e[1] * (x - a[0])       # >0 on the left of the edge (interior for this winding)
        if cr / np.linalg.norm(e) < m:
            return False
    return True


def clip_to_deck(a, b, m=0.0):
    """Clip the segment a->b (x,z) to the deck plan shrunk by m (Cyrus-Beck); returns (a', b') or None."""
    poly = deck_outline()
    n = len(poly)
    a = np.array(a, float)
    d = np.array(b, float) - a
    t0, t1 = 0.0, 1.0
    for i in range(n):
        p, q = np.array(poly[i]), np.array(poly[(i + 1) % n])
        e = q - p
        L = np.linalg.norm(e)
        nrm = np.array([-e[1], e[0]]) / L                # inward normal
        num = np.dot(a - p, nrm) - m
        den = np.dot(d, nrm)
        if abs(den) < 1e-12:
            if num < 0:
                return None
            continue
        t = -num / den
        if den > 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return a + d * t0, a + d * t1


# support columns: two rows; the north-west corner column (-14, -14.25) would stand in tower 2's footing zone
COL_XS = (-14.0, -5.0, 5.0, 14.0)
COLUMNS = [(x, z) for z in (-14.25, 14.25) for x in COL_XS if not (x == -14.0 and z < 0)]


def _ray_poly(pts, ang):
    d = np.array([math.cos(ang), math.sin(ang)])
    best = 1e9
    n = len(pts)
    for i in range(n):
        a = np.array(pts[i]); b = np.array(pts[(i + 1) % n])
        e = b - a
        M = np.array([[d[0], -e[0]], [d[1], -e[1]]])
        if abs(np.linalg.det(M)) < 1e-12:
            continue
        t, u = np.linalg.solve(M, a)
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = min(best, t)
    return d * best


def deck_geo():
    g = Geo()
    poly = deck_outline()
    # angle list: uniform + polygon corner angles so the strip hits the corners exactly
    ang = sorted(set([round(a, 6) for a in np.linspace(-math.pi, math.pi, 97)[:-1]] +
                     [round(math.atan2(z, x), 6) for x, z in poly]))
    outer = np.array([_ray_poly(poly, a) for a in ang])                      # (n,2) in (x, z)
    inner = np.array([[HOLE_R * math.cos(a), HOLE_R * math.sin(a)] for a in ang])
    top_o = [(x, OLM_TOP, z) for x, z in outer]
    top_i = [(x, OLM_TOP, z) for x, z in inner]
    pg.strip_between(g, "olm_steel", top_i, top_o, ref=np.array([0, 1.0, 0]))
    bot_o = [(x, BOT, z) for x, z in outer]
    bot_i = [(x, BOT, z) for x, z in inner]
    pg.strip_between(g, "olm_steel", bot_i, bot_o, ref=np.array([0, -1.0, 0]))
    pg.extrude_poly(g, "olm_steel", poly, BOT, OLM_TOP, caps=False)
    # inner wall of the opening (faces the axis)
    pg.revolve(g, "olm_steel", [(HOLE_R, OLM_TOP), (HOLE_R, BOT)], seg=96)
    # raised water-cooled flame ring around the opening (profile bottom->top on the outer surface)
    pg.revolve(g, "olm_steel", [(6.6, OLM_TOP), (5.9, OLM_TOP + 0.34), (HOLE_R, OLM_TOP + 0.30), (HOLE_R, OLM_TOP)], seg=96)
    # ---- underside stiffeners: a grid of ribs and heavier edge girders (clipped to the deck plan: the NW corner is cut) ----
    def _beam(a, b, w, h, y):
        c = clip_to_deck(a, b, 0.25)
        if c is not None and np.linalg.norm(c[1] - c[0]) > 0.5:
            pg.beams(g, "olm_steel", _v(c[0][0], y, c[0][1])[None], _v(c[1][0], y, c[1][1])[None], w, h)
    for k in np.arange(-13.6, 13.7, 4.25):
        if abs(k) < 0.1:
            continue
        _beam((-15.5, k), (15.5, k), 0.45, 0.56, BOT - 0.28)
        _beam((k, -15.5), (k, 15.5), 0.45, 0.56, BOT - 0.28)
    for s in (-1, 1):
        _beam((-15.9, s * 5.6), (15.9, s * 5.6), 0.7, 0.9, BOT - 0.45)
        _beam((s * 5.6, -15.9), (s * 5.6, 15.9), 0.7, 0.9, BOT - 0.45)
    # ring beam under the opening
    pg.revolve(g, "olm_steel", [(HOLE_R + 1.2, BOT), (HOLE_R + 0.9, BOT - 0.55), (HOLE_R, BOT - 0.55), (HOLE_R, BOT)], seg=64)
    # edge coping: a raised lip round the outer edge
    for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]):
        pg.beams(g, "olm_steel", _v(x0, OLM_TOP + 0.09, z0)[None], _v(x1, OLM_TOP + 0.09, z1)[None], 0.4, 0.22)
    return g


def details_geo():
    g = Geo()
    top = OLM_TOP
    # ---- 20 hold-down clamp arms around the opening (released / open: arms swung back and up) ----
    n = 20
    base_r = 6.55
    for k in range(n):
        a = math.radians(k * 18.0 + 9.0)
        ca, sa = math.cos(a), math.sin(a)
        rad = _v(ca, 0, -sa)
        R = pg.frame_from_z(rad[None], pg.UP)[0]          # x tangent, y up, z radial outward
        c = rad * base_r + _v(0, top + 0.36, 0)
        pg.box(g, "dark_steel", c, [1.25, 0.72, 0.9], R)                                   # base housing
        pg.box(g, "dark_steel", c + rad * -0.15 + _v(0, 0.5, 0), [1.4, 0.3, 0.5], R)       # hinge saddle
        pg.tubes(g, "galv", c + _v(0, 0.66, 0) - R[:, 0] * 0.55, c + _v(0, 0.66, 0) + R[:, 0] * 0.55, 0.11, seg=10)   # pivot pin
        # the clamp arm: rises from the hinge, hook at the top reaching inward over the booster skirt flange
        p0 = c + _v(0, 0.66, 0)
        p1 = c + _v(0, 1.55, 0) - rad * 0.35
        pg.beams(g, "dark_steel", p0[None], p1[None], 0.85, 0.32, up=rad)
        hook = p1 + _v(0, 0.12, 0) - rad * 0.28
        pg.box(g, "dark_steel", hook, [0.95, 0.34, 0.55], R)
        # hydraulic cylinder behind the arm
        cyl0 = c + rad * 0.32 + _v(0, 0.1, 0)
        cyl1 = c + rad * 0.12 + _v(0, 1.25, 0)
        pg.tubes(g, "stainless", cyl0[None], cyl1[None], 0.09, seg=8)
        pg.tubes(g, "dark_steel", cyl0[None], (cyl0 + (cyl1 - cyl0) * 0.45)[None], 0.13, seg=8)
    # ---- deluge nozzle ring and manifold ring on the deck (water-cooled plate) ----
    prof = [(7.55 + 0.22 * math.cos(t), top + 0.32 + 0.22 * math.sin(t)) for t in np.linspace(-math.pi / 2, 3 * math.pi / 2, 13)]
    pg.revolve(g, "stainless", prof, seg=72)
    a = np.linspace(0, math.tau, 80, endpoint=False)
    for rr in (8.6, 10.3, 12.4):
        c = np.stack([rr * np.cos(a), np.full_like(a, top), -rr * np.sin(a)], axis=1)
        c2 = c.copy(); c2[:, 1] += 0.16
        pg.tubes(g, "stainless", c, c2, 0.11, seg=6)
    # ---- booster QDs (LCH4 / LOX), west of the opening, on tracks ----
    for zq in (-3.2, 3.2):
        pg.box(g, "dark_steel", [-9.2, top + 1.2, zq], [2.6, 2.4, 2.4])
        pg.box(g, "galv", [-9.2, top + 2.6, zq], [2.8, 0.4, 2.6])
        pg.beams(g, "dark_steel", _v(-8.0, top + 1.6, zq)[None], _v(-6.4, top + 1.3, zq * 0.55)[None], 0.7, 0.7)
        pg.tubes(g, "galv", _v(-6.4, top + 1.3, zq * 0.55)[None], _v(-5.6, top + 1.2, zq * 0.5)[None], 0.36, seg=12)
        # hose loops behind the carriage
        ts = np.linspace(0, math.pi, 12)
        pts = np.stack([-10.5 - 1.8 * np.sin(ts), top + 0.5 + 1.6 * np.sin(ts) * 0.7 + 0.2, zq + 3.0 * np.cos(ts) - 1.5 * np.sign(zq)], axis=1)
        pg.tubes(g, "dark_steel", pts[:-1], pts[1:], 0.2, seg=8)
        pg.box(g, "dark_steel", [-11.4, top + 0.3, zq], [1.6, 0.5, 3.2])   # track sleepers
        for s in (-1, 1):
            pg.beams(g, "dark_steel", _v(-13.5, top + 0.2, zq + s * 1.0)[None], _v(-6.8, top + 0.2, zq + s * 1.0)[None], 0.16, 0.22)
    # ---- service hatches, lifting lugs, instrument boxes on the deck ----
    rng = np.random.RandomState(7)
    for (x, z, sx, sz) in ((12.0, -9.0, 3.0, 2.0), (12.0, 9.0, 3.0, 2.0), (-11.0, 12.0, 2.4, 2.4), (-2.0, 13.4, 4.0, 1.6), (4.0, -13.6, 3.6, 1.6)):
        pg.box(g, "galv", [x, top + 0.45, z], [sx, 0.9, sz])
        pg.box(g, "dark_steel", [x, top + 0.95, z], [sx + 0.15, 0.1, sz + 0.15])
    for x in (-15.0, 15.0):
        for z in (-15.0, 15.0):
            if deck_inside(x * 0.92, z * 0.92, 0.8):
                pg.box(g, "dark_steel", [x * 0.92, top + 0.2, z * 0.92], [1.0, 0.25, 1.0])
    # ---- perimeter railing (open along the stair landings), posts every 2 m ----
    poly = deck_outline()
    for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]):
        a0, a1 = np.array([x0, z0]) * 0.985, np.array([x1, z1]) * 0.985
        L = np.linalg.norm(a1 - a0)
        m = max(int(L // 2.0), 1)
        ts = np.linspace(0, 1, m + 1)
        px = a0[0] + (a1[0] - a0[0]) * ts
        pz = a0[1] + (a1[1] - a0[1]) * ts
        p0 = np.stack([px, np.full_like(px, top + 0.2), pz], axis=1)
        p1 = p0.copy(); p1[:, 1] = top + 1.3
        pg.tubes(g, "galv", p0, p1, 0.03, seg=6)
        for hy in (1.3, 0.8):
            pg.tubes(g, "galv", _v(a0[0], top + hy, a0[1])[None], _v(a1[0], top + hy, a1[1])[None], 0.025, seg=6)
    return g


def columns_geo():
    g = Geo()
    cs = COLUMNS
    y0 = APRON_TOP
    y1 = BOT
    for (x, z) in cs:
        pg.box(g, "concrete", [x, y0 + 0.3, z], [3.8, 0.6, 3.8])                # plinth
        pg.box(g, "olm_column", [x, (y0 + y1) / 2 + 0.3, z], [2.4, y1 - y0 - 0.6, 2.4])
        # corner angles and ring stiffeners so the columns read as fabricated steel, not plain boxes
        for yy in np.arange(y0 + 2.5, y1 - 1.0, 3.0):
            pg.box(g, "olm_column", [x, yy, z], [2.7, 0.16, 2.7])
        pg.box(g, "olm_column", [x, y1 - 0.15, z], [3.0, 0.3, 3.0])             # capital
        for sa in (-1, 1):
            for sb in (-1, 1):
                pg.tubes(g, "dark_steel", _v(x + sa * 1.35, y0 + 0.6, z + sb * 1.35)[None], _v(x + sa * 1.35, y0 + 1.1, z + sb * 1.35)[None], 0.11, seg=6)
    # X bracing between adjacent columns in each row (two levels), members 0.7 box
    for z in (-14.25, 14.25):
        xs = [x for x in COL_XS if (x, z) in COLUMNS]
        for xa, xb in zip(xs[:-1], xs[1:]):
            for (ya, yb) in ((2.0, 9.0), (9.0, 16.0)):
                pg.beams(g, "olm_column", _v(xa + 1.2, ya, z)[None], _v(xb - 1.2, yb, z)[None], 0.55, 0.7)
                pg.beams(g, "olm_column", _v(xa + 1.2, yb, z)[None], _v(xb - 1.2, ya, z)[None], 0.55, 0.7)
            pg.beams(g, "olm_column", _v(xa + 1.2, 9.0, z)[None], _v(xb - 1.2, 9.0, z)[None], 0.9, 0.9)
    # tie girders across the trench at x = +-9.5 (out of the plume path), mid height; the west one starts short of tower 2
    for x in (-9.5, 9.5):
        z0 = -13.0 if x > 0 else -10.6
        pg.beams(g, "olm_column", _v(x, 11.0, z0)[None], _v(x, 11.0, 13.0)[None], 1.1, 1.3)
        pg.beams(g, "olm_column", _v(x, 15.6, z0)[None], _v(x, 15.6, 13.0)[None], 0.8, 1.0)
        zs = np.linspace(z0 + 2.0, 11.0, 5)
        for zz in zs:
            pg.beams(g, "olm_column", _v(x, 11.0, zz)[None], _v(x, 15.6, zz + (zs[1] - zs[0]) / 2)[None], 0.4, 0.4)
    return g


def pipes_geo():
    """Deluge risers up the outer columns, the ring main under the deck, feed headers, nozzle stubs."""
    g = Geo()
    yr = BOT - 1.2
    # ring main under the deck edge: the deck outline inset by 1.8 m
    loop = inset_poly(deck_outline(), 1.8)
    for (x0, z0), (x1, z1) in zip(loop, loop[1:] + loop[:1]):
        pg.tubes(g, "stainless", _v(x0, yr, z0)[None], _v(x1, yr, z1)[None], 0.55, seg=16)
    for (x, z) in loop:
        pg.spheres(g, "stainless", [[x, yr, z]], 0.62, seg=14, rings=8)
    # risers on the outer sides of the outer columns, with flanged joints
    for (x, z) in ((-14.0, 14.25), (14.0, 14.25), (14.0, -14.25)):
        sx = 1.0 if x > 0 else -1.0
        sz = 1.0 if z > 0 else -1.0
        px, pz = x + sx * 1.9, z + sz * 0.0
        pg.tubes(g, "stainless", _v(px, APRON_TOP, pz)[None], _v(px, yr, pz)[None], 0.4, seg=14)
        for yy in np.arange(1.5, yr, 2.8):
            pg.tubes(g, "stainless", _v(px, yy, pz)[None], _v(px, yy + 0.2, pz)[None], 0.52, seg=14)
        pg.beams(g, "stainless", _v(px, yr, pz)[None], _v(x, yr, z)[None], 0.4, 0.3)
    # branch pipes from the ring main into the deck plate (cooling water feed), every 4 m along each side
    h = 15.2
    for k in np.arange(-12.0, 12.1, 4.0):
        for (x, z, dx, dz) in ((k, -h, 0, 1), (k, h, 0, -1), (-h, k, 1, 0), (h, k, -1, 0)):
            if deck_inside(x, z, 1.6):      # only where the ring main runs (the cut NW corner has its own chamfer run)
                pg.tubes(g, "stainless", _v(x, yr, z)[None], _v(x + dx * 1.4, BOT - 0.2, z + dz * 1.4)[None], 0.16, seg=8)
    return g


def stairs_geo():
    """A zig-zag access stair tower on the south side of the deck, outside the trench (five flights, 20 m rise),
    with a bridge onto the deck edge. Flights run along x; the tower stands at z = 20 (beyond the deck edge z = 17)."""
    g = Geo()
    zc = 20.0
    x_c = 8.0
    nfl = 5
    rise = OLM_TOP / nfl
    steps = 16
    run = 0.28
    w = 1.2
    L = steps * run
    for fl in range(nfl):
        y0 = fl * rise + APRON_TOP
        d = 1.0 if fl % 2 == 0 else -1.0
        xs = x_c - d * (L / 2)
        cents, sizes = [], []
        for k in range(steps):
            cents.append([xs + d * (k * run + run / 2), y0 + (k + 1) * rise / steps - 0.03, zc])
            sizes.append([run + 0.02, 0.05, w])
        pg.boxes(g, "grating", np.array(cents), np.array(sizes))
        x_end = xs + d * L
        for sz in (-1, 1):
            p0 = _v(xs, y0 + 0.2, zc + sz * w / 2)
            p1 = _v(x_end, y0 + rise + 0.2, zc + sz * w / 2)
            pg.beams(g, "galv", p0[None], p1[None], 0.24, 0.05, up=_v(0, 0, 1))
            pg.tubes(g, "galv", (p0 + _v(0, 1.0, 0))[None], (p1 + _v(0, 1.0, 0))[None], 0.03, seg=6)
        pg.box(g, "grating", [x_end + d * 0.5, y0 + rise - 0.02, zc], [1.2, 0.06, w + 0.4])
    for sx in (-1, 1):
        for sz in (-1, 1):
            pg.box(g, "galv", [x_c + sx * (L / 2 + 0.9), OLM_TOP / 2, zc + sz * 0.9], [0.2, OLM_TOP, 0.2])
    # bridge from the last landing onto the deck (the last flight ends at x_c + L/2 + 1.1 or x_c - ...)
    last_d = 1.0 if (nfl - 1) % 2 == 0 else -1.0
    x_land = x_c + last_d * (L / 2 + 0.5)
    pg.box(g, "grating", [x_land, OLM_TOP - 0.02, (zc + OLM_HALF) / 2], [1.4, 0.06, zc - OLM_HALF + 0.6])
    for sx in (-1, 1):
        pg.tubes(g, "galv", _v(x_land + sx * 0.7, OLM_TOP + 1.0, OLM_HALF)[None], _v(x_land + sx * 0.7, OLM_TOP + 1.0, zc)[None], 0.03, seg=6)
    return g


def build():
    return dict(olm_deck=deck_geo(), olm_details=details_geo(), olm_columns=columns_geo(), olm_pipes=pipes_geo(),
                olm_stairs=stairs_geo())
