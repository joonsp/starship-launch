"""Tower 2 (Orbital Launch and Integration Tower): lattice bays, top house, masts, rack rails, boom, base.

Tower-local frame: origin on the tower axis at ground, +x/+z horizontal (rotated to world by pad_layout.TOWER_YAW),
y up. The mount-facing corner is local (+,+). The camera-facing face is local +z (see research/camera-estimate.md).

Materials (Blender material names = roles in src/pad/materials.ts):
  tower_paint (red painted steel), tower_clad (top-house cladding), galv (stairs, rails, pipes), grating,
  dark_steel (cables, machinery, bolts), beacon (aviation lights), concrete (footings).
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
from pad_layout import (BAY, BOOM_Y, CHORD, HOUSE_Y0, HOUSE_Y1, MAST_TOP, N_BAYS, TOWER_HW)

HW = TOWER_HW
CORNERS = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]], dtype=float) * HW


def _p(a, y, b):
    return np.array([a, y, b], dtype=float)


def angles(g, mat, P0, P1, w, t):
    """L-section members (equal-leg angle, leg w, thickness t) along P0->P1: two thin plates sharing an edge."""
    P0 = np.atleast_2d(P0); P1 = np.atleast_2d(P1)
    R = pg.frame_from_z(P1 - P0)
    ex, ey = R[:, :, 0], R[:, :, 1]
    oa = ex * (-w / 2 + t / 2)
    ob = ey * (-w / 2 + t / 2)
    pg.beams(g, mat, P0 + oa, P1 + oa, t, w)
    pg.beams(g, mat, P0 + ob, P1 + ob, w, t)


def bay_geo(platform=False, lo=False, seed=0):
    """One 6 m lattice bay in tower-local coordinates (y from 0 to BAY). `lo` = a thickened low-detail version."""
    g = Geo()
    H = BAY
    ch = CHORD * (1.35 if lo else 1.0)
    # ---- chords (hollow-section look: box + 4 stiffener fins) -----------------------------------------
    for c in CORNERS:
        pg.box(g, "tower_paint", [c[0], H / 2, c[1]], [ch, H, ch])
        if not lo:
            sg = np.sign(c)
            for k in range(3):   # ring stiffeners
                y = 1.5 + 1.5 * k
                pg.box(g, "tower_paint", [c[0], y, c[1]], [ch + 0.16, 0.08, ch + 0.16])
            # corner angle lips running the length of the chord
            for sa, sb in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                pg.box(g, "tower_paint", [c[0] + sa * (ch / 2 + 0.03), H / 2, c[1] + sb * (ch / 2 + 0.03)], [0.06, H - 0.3, 0.06])
    # ---- face bracing -------------------------------------------------------------------------------
    dW, dH = (0.7, 0.8) if lo else (0.30, 0.38)
    d0, d1, hz = [], [], []
    gus_c, gus_R, gus_s, bolts = [], [], [], []
    for i in range(4):
        c0, c1 = CORNERS[i], CORNERS[(i + 1) % 4]
        n2 = (c0 + c1) / 2
        n2 = n2 / np.linalg.norm(n2)
        n3 = np.array([n2[0], 0, n2[1]])
        o = 0.2 * n3
        d0.append(_p(c0[0], 0.7, c0[1]) + o); d1.append(_p(c1[0], H - 0.7, c1[1]) + o)
        d0.append(_p(c1[0], 0.7, c1[1]) - o); d1.append(_p(c0[0], H - 0.7, c0[1]) - o)
        # horizontal struts: bottom and mid
        hz.append((_p(c0[0], 0.4, c0[1]), _p(c1[0], 0.4, c1[1]), 0.55, 0.5))
        hz.append((_p(c0[0], H / 2, c0[1]), _p(c1[0], H / 2, c1[1]), 0.3, 0.3))
        if not lo:
            # gusset plates + bolt heads at the bottom corners of each face
            t = (c1 - c0) / np.linalg.norm(c1 - c0)
            t3 = np.array([t[0], 0, t[1]])
            for cc, sgn in ((c0, 1.0), (c1, -1.0)):
                ctr = _p(cc[0], 1.0, cc[1]) + n3 * 0.40 + t3 * sgn * 0.75
                R = pg.frame_from_z(n3)[0]      # local z = face normal
                gus_c.append(ctr)
                gus_R.append(R)
                gus_s.append([2.2, 1.6, 0.08])
                for ix in range(3):
                    for iy in range(3):
                        bp = ctr + t3 * sgn * (-0.7 + 0.7 * ix) + np.array([0, -0.5 + 0.5 * iy, 0]) + n3 * 0.06
                        bolts.append(bp)
    if lo:
        pg.beams(g, "tower_paint", np.array(d0), np.array(d1), dW, dH)
    else:
        angles(g, "tower_paint", np.array(d0), np.array(d1), 0.36, 0.045)
        # stitch plate at each X crossing
        for i in range(4):
            c0, c1 = CORNERS[i], CORNERS[(i + 1) % 4]
            n2 = (c0 + c1) / 2
            n2 = n2 / np.linalg.norm(n2)
            n3 = np.array([n2[0], 0, n2[1]])
            t = (c1 - c0) / np.linalg.norm(c1 - c0)
            t3 = np.array([t[0], 0, t[1]])
            Rf = pg.frame_from_z(n3)[0]
            pg.box(g, "tower_paint", _p((c0[0] + c1[0]) / 2, H / 2, (c0[1] + c1[1]) / 2) + n3 * 0.02, [0.9, 0.9, 0.05], Rf)
    for p0, p1, w, h in hz:
        pg.beams(g, "tower_paint", p0, p1, w, h)
    if gus_c:
        pg.boxes(g, "tower_paint", np.array(gus_c), np.array(gus_s), np.array(gus_R))
        # bolt heads: little hex cylinders lying on the gussets (axis = face normal)
        bolts = np.array(bolts)
        nrm = bolts.copy(); nrm[:, 1] = 0
        nrm = nrm / np.linalg.norm(nrm, axis=1, keepdims=True)
        # normal per bolt = dominant horizontal axis of the outward direction
        pg.tubes(g, "dark_steel", bolts, bolts + nrm * 0.07, 0.075, seg=6)
    # ---- plan bracing (tubes) at the bay bottom ------------------------------------------------------
    r = 0.11 if not lo else 0.25
    pg.tubes(g, "tower_paint", [[-HW, 0.25, -HW]], [[HW, 0.25, HW]], r, seg=6 if not lo else 4)
    pg.tubes(g, "tower_paint", [[HW, 0.32, -HW]], [[-HW, 0.32, HW]], r, seg=6 if not lo else 4)
    if lo:
        return g
    # ---- interior platform (every second bay) ---------------------------------------------------------
    inner = HW - CHORD / 2        # inner face of the chords = 4.9
    if platform:
        wgt = 1.4
        for sgn in (-1, 1):
            # slabs along a (b = +-(inner - w/2)) and along b (a = +-(inner - w/2))
            pg.box(g, "grating", [0, 0.53, sgn * (inner - wgt / 2)], [2 * inner, 0.06, wgt])
            pg.box(g, "grating", [sgn * (inner - wgt / 2), 0.53, 0], [wgt, 0.06, 2 * (inner - wgt)])
            pg.box(g, "galv", [0, 0.44, sgn * (inner - wgt / 2)], [2 * inner, 0.16, 0.10])
            pg.box(g, "galv", [sgn * (inner - wgt / 2), 0.44, 0], [0.10, 0.16, 2 * (inner - wgt)])
            # toe plates on the inner edge
            pg.box(g, "galv", [0, 0.62, sgn * (inner - wgt)], [2 * inner, 0.12, 0.03])
            pg.box(g, "galv", [sgn * (inner - wgt), 0.62, 0], [0.03, 0.12, 2 * (inner - wgt)])
        # handrails around the inner edge (open where the stairs come up: simplified to a full ring)
        e = inner - wgt
        loops = [((-e, -e), (e, -e)), ((e, -e), (e, e)), ((e, e), (-e, e)), ((-e, e), (-e, -e))]
        for (a0, b0), (a1, b1) in loops:
            pg.tubes(g, "galv", [[a0, 1.62, b0]], [[a1, 1.62, b1]], 0.035, seg=6)
            pg.tubes(g, "galv", [[a0, 1.1, b0]], [[a1, 1.1, b1]], 0.025, seg=6)
            L = math.hypot(a1 - a0, b1 - b0)
            nposts = int(L // 1.6) + 1
            ts = np.linspace(0, 1, nposts)
            pa = a0 + (a1 - a0) * ts
            pb = b0 + (b1 - b0) * ts
            p0 = np.stack([pa, np.full_like(pa, 0.56), pb], axis=1)
            p1 = p0.copy(); p1[:, 1] = 1.62
            pg.tubes(g, "galv", p0, p1, 0.03, seg=6)
    # ---- stairs: two switch-back flights along the -b inner face -------------------------------------
    stair_w = 1.0
    b_a = -(inner - 0.8)
    b_b = -(inner - 0.8) + stair_w + 0.25
    nsteps = 12
    rise = (H / 2) / nsteps
    run = 0.30
    for fl in range(2):
        y0 = 0.62 + fl * H / 2
        bb = b_a if fl == 0 else b_b
        direction = 1.0 if fl == 0 else -1.0
        a_start = -inner + 1.0 if fl == 0 else -inner + 1.0 + nsteps * run
        cents, sizes = [], []
        for k in range(nsteps):
            a = a_start + direction * (k * run + run / 2)
            cents.append([a, y0 + (k + 1) * rise - 0.03, bb])
            sizes.append([run + 0.02, 0.05, stair_w])
        pg.boxes(g, "grating", np.array(cents), np.array(sizes))
        a_end = a_start + direction * nsteps * run
        for sd in (-1, 1):
            p0 = _p(a_start, y0 + 0.2, bb + sd * stair_w / 2)
            p1 = _p(a_end, y0 + nsteps * rise + 0.2, bb + sd * stair_w / 2)
            pg.beams(g, "galv", p0[None], p1[None], 0.05, 0.22, up=np.array([0, 0, 1.0]))
            pg.tubes(g, "galv", (p0 + [0, 1.0, 0])[None], (p1 + [0, 1.0, 0])[None], 0.03, seg=6)
    # landing at the turn
    pg.box(g, "grating", [-inner + 1.0 + nsteps * run + 0.4, 0.62 + H / 2, -(inner - 0.8) + 0.6], [1.0, 0.05, 2.1])
    # ---- risers: process pipes, conduit tray, elevator guide rails ------------------------------------
    for k, (pa, pb, rr) in enumerate(((-inner + 0.35, inner - 0.35, 0.17), (-inner + 0.9, inner - 0.35, 0.11), (inner - 0.35, inner - 0.35, 0.14))):
        pg.tubes(g, "galv", [[pa, 0, pb]], [[pa, H, pb]], rr, seg=10)
        for y in (0.9, 3.0, 5.1):
            pg.box(g, "dark_steel", [pa, y, pb], [rr * 2 + 0.1, 0.07, rr * 2 + 0.1])
            pg.box(g, "dark_steel", [pa, y, pb + rr + 0.2], [0.06, 0.06, 0.3])
    pg.box(g, "galv", [0.0, H / 2, -HW + 0.9 + CHORD / 2 + 0.05], [0.5, H, 0.05])          # cable tray
    for y in np.arange(0.4, H, 0.4):
        pg.box(g, "galv", [0.0, y, -HW + 0.95 + CHORD / 2], [0.5, 0.025, 0.12])
    # elevator guide rails on the outside of the -z face
    for a in (-1.3, 1.3):
        pg.box(g, "dark_steel", [a, H / 2, -HW - CHORD / 2 - 0.55], [0.22, H, 0.22])
        for y in (0.3, 3.3):
            pg.box(g, "dark_steel", [a, y, -HW - CHORD / 2 - 0.25], [0.12, 0.18, 0.55])
    # outside ladder with safety cage on the -x face
    lx = -HW - CHORD / 2 - 0.45
    lz = -2.5
    for dz in (-0.25, 0.25):
        pg.box(g, "galv", [lx, H / 2, lz + dz], [0.06, H, 0.06])
    ys = np.arange(0.3, H, 0.3)
    pg.boxes(g, "galv", np.stack([np.full_like(ys, lx), ys, np.full_like(ys, lz)], axis=1), [0.03, 0.03, 0.5])
    for yy in np.arange(2.6, H, 1.5):
        for k in range(7):
            a0 = math.radians(-90 + k * 30 - 90)
            a1 = math.radians(-90 + (k + 1) * 30 - 90)
            pg.tubes(g, "galv", _p(lx - 0.45 * math.sin(a0), yy, lz + 0.45 * math.cos(a0))[None],
                     _p(lx - 0.45 * math.sin(a1), yy, lz + 0.45 * math.cos(a1))[None], 0.02, seg=4)
    return g


def base_geo():
    """Tower foundations and ground-level equipment (tower-local frame, y >= -1.5)."""
    g = Geo()
    for c in CORNERS:
        pg.box(g, "concrete", [c[0], -0.6, c[1]], [4.2, 2.4, 4.2])
        pg.box(g, "dark_steel", [c[0], 0.9, c[1]], [2.0, 0.12, 2.0])
        # anchor bolts
        for sa in (-0.8, 0.8):
            for sb in (-0.8, 0.8):
                pg.tubes(g, "dark_steel", [[c[0] + sa, 0.9, c[1] + sb]], [[c[0] + sa, 1.45, c[1] + sb]], 0.07, seg=6)
    # tie beams at ground
    for i in range(4):
        c0, c1 = CORNERS[i], CORNERS[(i + 1) % 4]
        pg.beams(g, "concrete", _p(c0[0], 0.2, c0[1])[None], _p(c1[0], 0.2, c1[1])[None], 1.3, 1.1)
    # heavy ground-level braces (first bay): stub K braces
    # the OSM roof annex (pad_extras.tower_annex) covers the north-west faces; the foot itself gets a service slab
    pg.box(g, "concrete", [0, -0.05, HW + 4.5], [14, 0.3, 6.5])
    pg.box(g, "galv", [5.0, 1.0, HW + 5.0], [2.6, 2.0, 1.6])
    return g


def rails_geo():
    """Carriage rack-and-pinion rails run up the mount-facing corner (local (+,+)): one rail on each of the
    two chord faces that meet there, standing proud of the chord on brackets, with a toothed rack."""
    g = Geo()
    y0, y1 = 3.0, 133.0
    for n in ((1.0, 0.0), (0.0, 1.0)):
        nv = np.array([n[0], 0.0, n[1]])
        tv = np.array([n[1], 0.0, n[0]])            # across the rail (horizontal, perpendicular to n)
        base = np.array([HW, 0.0, HW]) + nv * (CHORD / 2 + 0.5) + tv * 0.0
        size_n, size_t = 0.22, 0.55
        sz = [size_n if n[0] else size_t, y1 - y0, size_t if n[0] else size_n]
        pg.box(g, "dark_steel", base + [0, (y0 + y1) / 2, 0], sz)
        # brackets back to the chord every 3 m
        ys = np.arange(y0, y1, 3.0)
        cents = np.stack([np.full_like(ys, base[0] - nv[0] * 0.28), ys, np.full_like(ys, base[2] - nv[2] * 0.28)], axis=1)
        pg.boxes(g, "dark_steel", cents, [0.4 if n[0] else 0.5, 0.35, 0.5 if n[0] else 0.4])
        # rack teeth (0.3 m pitch) on the outer face of the rail
        yt = np.arange(y0 + 0.3, y1 - 0.3, 0.30)
        tc = np.stack([np.full_like(yt, base[0] + nv[0] * 0.15), yt, np.full_like(yt, base[2] + nv[2] * 0.15)], axis=1)
        pg.boxes(g, "galv", tc, [0.1 if n[0] else 0.36, 0.15, 0.36 if n[0] else 0.1])
    return g


def elevator_car():
    g = Geo()
    pg.box(g, "galv", [0, 1.7, 0], [2.2, 3.4, 2.4])
    pg.box(g, "dark_steel", [0, 3.5, 0], [2.4, 0.15, 2.6])
    pg.box(g, "dark_steel", [0, 0.1, 0], [2.4, 0.2, 2.6])
    return g


def top_geo():
    """Cladded top house, roof machinery, sheaves, lightning masts, aviation lights, cables down to the carriage."""
    g = Geo()
    y0, y1 = HOUSE_Y0, HOUSE_Y1
    w = 2 * HW + CHORD + 0.3          # 12.3 m
    hh = y1 - y0
    # cladded shell: skin + vertical ribs every 1.1 m + belt rails
    pg.box(g, "tower_clad", [0, (y0 + y1) / 2, 0], [w, hh, w])
    xs = np.arange(-w / 2 + 0.6, w / 2, 1.1)
    for s in (-1, 1):
        cents = np.stack([xs, np.full_like(xs, (y0 + y1) / 2), np.full_like(xs, s * (w / 2 + 0.05))], axis=1)
        pg.boxes(g, "tower_paint", cents, [0.18, hh - 0.6, 0.14])
        cents = np.stack([np.full_like(xs, s * (w / 2 + 0.05)), np.full_like(xs, (y0 + y1) / 2), xs], axis=1)
        pg.boxes(g, "tower_paint", cents, [0.14, hh - 0.6, 0.18])
    for y in (y0 + 0.4, y0 + hh / 2, y1 - 0.4):
        pg.box(g, "tower_paint", [0, y, 0], [w + 0.4, 0.25, w + 0.4])
    # louvre bands + doors
    for s in (-1, 1):
        for k in range(6):
            pg.box(g, "dark_steel", [-2 + 0 * k, y0 + 3.0 + k * 0.25, s * (w / 2 + 0.1)], [3.4, 0.08, 0.1])
    pg.box(g, "dark_steel", [3.5, y0 + 1.5, w / 2 + 0.1], [1.6, 2.6, 0.12])
    pg.box(g, "dark_steel", [-w / 2 - 0.1, y0 + 1.5, 3.0], [0.12, 2.6, 1.6])
    # roof: parapet, hatch, crane pedestal and jib, sheave wheels
    pg.box(g, "tower_paint", [0, y1 + 0.05, 0], [w + 0.5, 0.2, w + 0.5])
    for s in (-1, 1):
        pg.box(g, "tower_paint", [0, y1 + 0.55, s * (w / 2 + 0.1)], [w + 0.3, 1.0, 0.12])
        pg.box(g, "tower_paint", [s * (w / 2 + 0.1), y1 + 0.55, 0], [0.12, 1.0, w + 0.3])
    pg.box(g, "dark_steel", [-3.0, y1 + 0.5, -3.0], [2.4, 0.8, 2.4])
    pg.tubes(g, "tower_paint", [[-3.0, y1 + 0.9, -3.0]], [[-3.0, y1 + 3.4, -3.0]], 0.35, seg=10)
    pg.beams(g, "tower_paint", np.array([[-3.0, y1 + 3.3, -3.0]]), np.array([[3.5, y1 + 2.9, -2.0]]), 0.35, 0.5)
    # sheave stand at the mount-facing corner (local +,+): two big wheels with hubs, cables leave downward
    cxs = np.array([[HW - 1.8, y1 + 1.5, HW - 1.6], [HW - 1.8, y1 + 1.5, HW - 3.0]])
    for cpos in cxs:
        pg.tubes(g, "dark_steel", (cpos + [0, 0, -0.18])[None], (cpos + [0, 0, 0.18])[None], 1.2, seg=28)
        pg.tubes(g, "galv", (cpos + [0, 0, -0.30])[None], (cpos + [0, 0, 0.30])[None], 0.3, seg=12)
    pg.box(g, "tower_paint", [HW - 1.8, y1 + 0.75, HW - 2.3], [0.5, 1.5, 2.2])
    pg.box(g, "tower_paint", [HW - 1.8 - 1.4, y1 + 0.75, HW - 2.3], [0.3, 1.5, 2.6])
    pg.box(g, "tower_paint", [HW - 1.8 + 1.4, y1 + 0.75, HW - 2.3], [0.3, 1.5, 2.6])
    # cables to the carriage plus counterweights in the well
    for k, (da, db) in enumerate(((0.0, 0.0), (0.35, 0.0), (0.0, -0.35), (0.35, -0.35))):
        x, z = HW - 1.2 + da, HW - 1.6 + db
        pg.tubes(g, "dark_steel", [[x, 127.3, z]], [[x, y1 + 1.5, z]], 0.045, seg=6)
        pg.box(g, "dark_steel", [x, 127.15, z], [0.32, 0.3, 0.32])            # cable socket on the carriage collar
        pg.tubes(g, "galv", [[x, 127.3, z]], [[x, 127.7, z]], 0.09, seg=8)
    # counterweight run: cables over the second sheave down the inside of the tower to two stacked weights
    for k, cz in enumerate((HW - 3.0, HW - 1.6)):
        cx = HW - 1.8
        zc_ = cz - 1.25 - k * 0.0
        pg.tubes(g, "dark_steel", [[cx + 0.15 - 0.3 * k, y1 + 1.5, zc_]], [[cx + 0.15 - 0.3 * k, 104.5, zc_ - 0.2]], 0.04, seg=6)
        pg.box(g, "dark_steel", [cx + 0.15 - 0.3 * k, 101.8, zc_ - 0.2], [1.1, 5.4, 0.8])
        pg.box(g, "galv", [cx + 0.15 - 0.3 * k, 104.3, zc_ - 0.2], [1.3, 0.18, 1.0])
    return g


def masts_geo():
    """Four lightning masts on the roof corners (tip at MAST_TOP), aviation beacons, guy struts."""
    g = Geo()
    y1 = HOUSE_Y1
    w = 2 * HW + CHORD + 0.3
    for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, z = sa * (w / 2 - 0.6), sb * (w / 2 - 0.6)
        base = y1 + 1.1
        pg.tubes(g, "galv", [[x, base, z]], [[x, base + 1.8, z]], 0.16, seg=8)
        pg.tubes(g, "galv", [[x, base + 1.8, z]], [[x, MAST_TOP - 0.2, z]], 0.07, seg=8)
        pg.spheres(g, "galv", [[x, MAST_TOP - 0.15, z]], 0.12)
        # guy struts
        pg.tubes(g, "galv", [[x - sa * 0.8, y1 + 0.5, z]], [[x, base + 1.4, z]], 0.04, seg=5)
        pg.tubes(g, "galv", [[x, y1 + 0.5, z - sb * 0.8]], [[x, base + 1.4, z]], 0.04, seg=5)
    pg.spheres(g, "beacon", [[w / 2 - 0.6, y1 + 2.6, 0], [-w / 2 + 0.6, y1 + 2.6, 0]], 0.22)
    return g


def boom_geo():
    """West-side QD / service arm: in the photo a squat orange pod ~14 m wide and ~8 m tall hugging the tower's left
    face at ~70-78 m, with a frosted umbilical hanging ~13 m below it. Built along local -x (tower-local frame)."""
    g = Geo()
    y = BOOM_Y
    xt = -HW - CHORD / 2 - 0.35       # tower face
    x0 = xt - 2.2                     # pod root: the photo shows a ~2.5 m gap between pod and tower face
    Lp = 12.5
    xc = x0 - Lp / 2
    zc = -0.6
    W = 5.2                       # depth (along b)
    Hh = 6.4                      # pod height
    pg.box(g, "tower_clad", [xc, y, zc], [Lp, Hh, W])
    # roof deck with a parapet rail, hatch and vent
    pg.box(g, "dark_steel", [xc, y + Hh / 2 + 0.12, zc], [Lp + 0.5, 0.25, W + 0.5])
    for sz in (-1, 1):
        pg.tubes(g, "galv", _p(x0, y + Hh / 2 + 1.25, zc + sz * (W / 2 + 0.2))[None], _p(x0 - Lp, y + Hh / 2 + 1.25, zc + sz * (W / 2 + 0.2))[None], 0.03, seg=6)
        pg.tubes(g, "galv", _p(x0, y + Hh / 2 + 0.75, zc + sz * (W / 2 + 0.2))[None], _p(x0 - Lp, y + Hh / 2 + 0.75, zc + sz * (W / 2 + 0.2))[None], 0.025, seg=6)
    pg.tubes(g, "galv", _p(x0 - Lp, y + Hh / 2 + 1.25, zc - W / 2 - 0.2)[None], _p(x0 - Lp, y + Hh / 2 + 1.25, zc + W / 2 + 0.2)[None], 0.03, seg=6)
    xs_ = np.linspace(x0 - 0.3, x0 - Lp + 0.3, 9)
    for xx in xs_:
        for sz in (-1, 1):
            pg.tubes(g, "galv", _p(xx, y + Hh / 2 + 0.25, zc + sz * (W / 2 + 0.2))[None], _p(xx, y + Hh / 2 + 1.25, zc + sz * (W / 2 + 0.2))[None], 0.03, seg=6)
    pg.box(g, "galv", [xc + 2.0, y + Hh / 2 + 0.75, zc + 0.6], [2.4, 1.0, 1.6])
    pg.tubes(g, "galv", _p(xc - 2.2, y + Hh / 2 + 0.25, zc)[None], _p(xc - 2.2, y + Hh / 2 + 1.7, zc)[None], 0.3, seg=10)
    # panel seams / ribs, louvre band and a door on the camera-facing (+b) wall
    for xx in np.linspace(x0 - 1.0, x0 - Lp + 1.0, 6):
        pg.box(g, "tower_paint", [xx, y, zc + W / 2 + 0.05], [0.16, Hh - 0.3, 0.12])
    pg.box(g, "dark_steel", [xc - 2.5, y - 0.4, zc + W / 2 + 0.08], [1.5, 3.0, 0.1])
    for k in range(6):
        pg.box(g, "dark_steel", [xc + 2.5, y + 1.6 - k * 0.3, zc + W / 2 + 0.08], [3.0, 0.1, 0.1])
    # lower truss frame under the pod (X bracing) carrying the QD hardware
    yb = y - Hh / 2 - 1.6
    for sz in (-1, 1):
        zz = zc + sz * (W / 2 - 0.3)
        pg.beams(g, "tower_paint", _p(x0, yb, zz)[None], _p(x0 - Lp, yb, zz)[None], 0.3, 0.3)
        for i in range(5):
            xa, xb = x0 - i * Lp / 5, x0 - (i + 1) * Lp / 5
            pg.beams(g, "tower_paint", _p(xa, yb, zz)[None], _p(xb, yb + 1.6, zz)[None], 0.16, 0.2)
            pg.beams(g, "tower_paint", _p(xa, yb + 1.6, zz)[None], _p(xb, yb, zz)[None], 0.16, 0.2)
    # pivot yoke at the pod root and two link trusses back to the tower face
    pg.box(g, "dark_steel", [x0 + 0.3, y, zc], [1.2, Hh + 0.4, W + 0.4])
    for yy in (y + Hh / 2 - 0.4, y - Hh / 2 - 1.6):
        for sz in (-1, 1):
            pg.beams(g, "tower_paint", _p(xt, yy, zc + sz * (W / 2 - 0.3))[None], _p(x0, yy, zc + sz * (W / 2 - 0.3))[None], 0.32, 0.32)
        pg.beams(g, "tower_paint", _p(xt, yy - 0.4, zc + (W / 2 - 0.3))[None], _p(x0, yy + 0.4, zc - (W / 2 - 0.3))[None], 0.18, 0.18)
    # stay rods to the tower above
    for dz in (-2.0, 0.0, 2.0):
        pg.tubes(g, "galv", _p(x0 - Lp + 1.0, y + Hh / 2 + 0.1, zc + dz * 0.5)[None], _p(x0 + 0.2, y + 16.0, zc + dz)[None], 0.05, seg=6)
    # outboard QD head and the frosted hanging umbilical
    pg.tubes(g, "galv", _p(x0 - Lp, y - 0.5, zc)[None], _p(x0 - Lp - 1.6, y - 0.5, zc)[None], 0.55, seg=14)
    ux = x0 - Lp + 2.6
    pg.box(g, "dark_steel", [ux, y - Hh / 2 - 0.5, zc], [1.6, 0.6, 1.6])
    pg.tubes(g, "galv", _p(ux, y - Hh / 2 - 0.8, zc)[None], _p(ux, y - Hh / 2 - 1.8, zc)[None], 0.42, seg=14)
    ts = np.linspace(0, 1, 16)
    pts = np.stack([ux + 0.5 * np.sin(ts * 2.2), y - Hh / 2 - 1.8 - 11.0 * ts, zc + 0.0 * ts], axis=1)
    pg.tubes(g, "pipe_insul", pts[:-1], pts[1:], 0.32, seg=10)
    pg.tubes(g, "galv", _p(pts[-1][0], pts[-1][1], zc)[None], _p(pts[-1][0], pts[-1][1] - 1.4, zc)[None], 0.5, seg=12)
    # counterweight box on the tower face and an access walkway beside the pod
    pg.box(g, "dark_steel", [x0 + 1.4, y + 4.3, zc], [2.4, 1.4, 1.6])
    pg.box(g, "grating", [xc, y - Hh / 2 - 0.1, zc + W / 2 + 0.9], [Lp, 0.05, 1.4])
    return g
