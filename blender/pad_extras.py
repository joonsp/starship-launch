"""Extra structures: the tower-base annex (OSM roof polygon), aviation beacons, OLM service platforms, apron props.

The annex polygon is the OSM way tagged building=roof height=10.5 that wraps the north-west faces of tower 2. In the
tower-local frame (a along the rotated x axis, b along z) it is an L: the outer boundary below (metres).
Materials: annex (grey panel cladding), galv, dark_steel, grating, concrete, beacon, olm_column.
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
from pad_layout import APRON_TOP, TOWER_HW, CHORD, TR_WALL_OUT, OLM_TOP, OLM_THICK


def _v(x, y, z):
    return np.array([x, y, z], dtype=float)


# outer boundary of the annex in tower-local (a, b), counter-clockwise seen in (a,b); derived from the OSM polygon
ANNEX = [(6.03, -6.26), (6.0, -11.9), (-10.2, -11.75), (-11.3, -10.6), (-11.4, 5.55), (-5.75, 5.5), (-5.75, -6.1)]
ANNEX_H = 10.5


def tower_annex():
    """Tower-local geometry of the annex: clad walls, flat roof with parapet, doors, roof plant, an outside stair."""
    g = Geo()
    pts = ANNEX
    pg.extrude_poly(g, "annex", pts, 0.0, ANNEX_H, caps=True, sides=True)
    # parapet and roof edge beam
    n = len(pts)
    for i in range(n):
        a, b = np.array(pts[i]), np.array(pts[(i + 1) % n])
        pg.beams(g, "annex", _v(a[0], ANNEX_H + 0.45, a[1])[None], _v(b[0], ANNEX_H + 0.45, b[1])[None], 0.25, 0.9)
        pg.beams(g, "dark_steel", _v(a[0], ANNEX_H - 0.1, a[1])[None], _v(b[0], ANNEX_H - 0.1, b[1])[None], 0.42, 0.3)
    # roll-up doors (dark) and personnel doors on the three outer faces
    for (a, b), (c, d) in ((pts[1], pts[2]), (pts[3], pts[4]), (pts[0], pts[1])):
        p0, p1 = np.array([a, b]), np.array([c, d])
        L = np.linalg.norm(p1 - p0)
        t = (p1 - p0) / L
        nrm = np.array([t[1], -t[0]])   # outward for a CCW polygon in (a,b)
        for k, s in enumerate((0.28, 0.72)):
            ctr = p0 + t * L * s + nrm * 0.06
            R = pg.frame_from_z(np.array([[nrm[0], 0, nrm[1]]]))[0]
            pg.box(g, "dark_steel", [ctr[0], 2.3, ctr[1]], [3.6, 4.6, 0.14], R)
            pg.box(g, "galv", [ctr[0], 4.75, ctr[1]], [3.9, 0.35, 0.3], R)
        ctr = p0 + t * L * 0.5 + nrm * 0.06
        R = pg.frame_from_z(np.array([[nrm[0], 0, nrm[1]]]))[0]
        pg.box(g, "galv", [ctr[0], 1.1, ctr[1]], [1.0, 2.2, 0.12], R)
    # roof plant: chiller boxes with fans, vent stacks, a cable ladder
    for (x, z, sx, sz) in ((-8.5, -3.0, 3.0, 2.2), (-8.5, 1.5, 3.0, 2.2), (0.0, -9.2, 4.2, 2.4), (3.2, -9.2, 2.0, 2.4)):
        pg.box(g, "galv", [x, ANNEX_H + 1.4, z], [sx, 1.8, sz])
        pg.tubes(g, "dark_steel", _v(x, ANNEX_H + 2.3, z)[None], _v(x, ANNEX_H + 2.4, z)[None], min(sx, sz) * 0.36, seg=18)
    for (x, z) in ((-3.0, -9.5), (-2.0, -10.5), (5.0, -8.0)):
        pg.tubes(g, "galv", _v(x, ANNEX_H, z)[None], _v(x, ANNEX_H + 2.2, z)[None], 0.22, seg=10)
        pg.tubes(g, "galv", _v(x, ANNEX_H + 2.2, z)[None], _v(x + 0.5, ANNEX_H + 2.4, z)[None], 0.22, seg=10)
    # external stair up the west end
    x0 = -11.6
    for k in range(20):
        pg.box(g, "grating", [x0 - 0.6, 0.25 + k * 0.5, 3.0 - k * 0.35], [1.2, 0.05, 0.4])
    return g


def tower_beacons():
    """Red obstruction lights on the tower body (mid height and upper third)."""
    g = Geo()
    hw = TOWER_HW + CHORD / 2 + 0.1
    for y in (66.0, 102.0):
        for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pg.spheres(g, "beacon", [[sa * hw, y, sb * hw]], 0.22, seg=8, rings=5)
            pg.box(g, "dark_steel", [sa * (hw - 0.12), y - 0.25, sb * (hw - 0.12)], [0.35, 0.16, 0.35])
    return g


def olm_platforms():
    """Service catwalks on both long sides of the mount at y = 9.5 (outboard of the column rows), ladders to the ground."""
    g = Geo()
    y = 9.5
    for s in (-1, 1):
        z = s * 16.9
        pg.box(g, "grating", [0, y, z], [34.0, 0.06, 1.5])
        pg.beams(g, "olm_column", _v(-17, y - 0.15, z - 0.7)[None], _v(17, y - 0.15, z - 0.7)[None], 0.16, 0.3)
        pg.beams(g, "olm_column", _v(-17, y - 0.15, z + 0.7)[None], _v(17, y - 0.15, z + 0.7)[None], 0.16, 0.3)
        for x in (-14.0, -5.0, 5.0, 14.0):
            pg.beams(g, "olm_column", _v(x, y - 0.25, s * 15.2)[None], _v(x, y - 0.25, z + s * 0.75)[None], 0.25, 0.4)
        # handrail (outer edge)
        xs = np.linspace(-17, 17, 18)
        p0 = np.stack([xs, np.full_like(xs, y), np.full_like(xs, z + s * 0.72)], axis=1)
        pg.tubes(g, "galv", p0, p0 + _v(0, 1.1, 0), 0.03, seg=6)
        for hy in (1.1, 0.6):
            pg.tubes(g, "galv", (p0[0] + _v(0, hy, 0))[None], (p0[-1] + _v(0, hy, 0))[None], 0.03, seg=6)
        # ladder with cage at each end
        for x in (-16.0, 16.0):
            zz = z + s * 0.6
            for dz in (-0.25, 0.25):
                pg.box(g, "galv", [x + dz, y / 2, zz], [0.06, y, 0.06])
            ys = np.arange(0.4, y, 0.3)
            pg.boxes(g, "galv", np.stack([np.full_like(ys, x), ys, np.full_like(ys, zz)], axis=1), [0.5, 0.03, 0.03])
            for yy in np.arange(2.4, y, 1.2):
                for k in range(7):
                    a0 = math.radians(-90 + k * 30 - 90)
                    a1 = math.radians(-90 + (k + 1) * 30 - 90)
                    pg.tubes(g, "galv", _v(x + 0.45 * math.cos(a0), yy, zz + s * 0.45 * math.sin(a0))[None],
                             _v(x + 0.45 * math.cos(a1), yy, zz + s * 0.45 * math.sin(a1))[None], 0.02, seg=4)
    # a hoist beam and pulley above the deck edge on the south side (for equipment), and hydraulic power units on the platform
    for x, zz in ((-9.0, -16.9), (9.0, -16.9)):
        pg.box(g, "galv", [x, y + 0.8, zz], [2.2, 1.4, 1.1])
        pg.tubes(g, "dark_steel", _v(x, y + 1.5, zz)[None], _v(x, y + 1.55, zz)[None], 0.4, seg=14)
    return g


def apron_props():
    """Apron furniture: bollards along the apron edge, manhole covers, cable-tray covers, hydrants, a few GSE skids."""
    g = Geo()
    rng = np.random.RandomState(11)
    # bollards on the apron edge every 15 m (steel posts with reflective bands)
    for x in np.arange(-88.0, 89.0, 15.0):
        for z in (-69.0, 69.0):
            pg.cyl_y(g, "galv", [[x, APRON_TOP, z]], 0.13, 1.0, seg=8)
            pg.cyl_y(g, "dark_steel", [[x, APRON_TOP + 0.75, z]], 0.135, 0.12, seg=8)
    for z in np.arange(-60.0, 61.0, 15.0):
        for x in (-89.0, 89.0):
            pg.cyl_y(g, "galv", [[x, APRON_TOP, z]], 0.13, 1.0, seg=8)
    # manholes and valve pits (round covers, square frames)
    for (x, z) in ((-28, -22), (-45, 20), (55, 30), (62, -20), (30, 35), (-60, -10), (-52, 58), (25, -55)):
        pg.cyl_y(g, "dark_steel", [[x, APRON_TOP, z]], 0.65, 0.04, seg=20)
        pg.cyl_y(g, "dark_steel", [[x, APRON_TOP, z]], 0.8, 0.02, seg=20)
    # cable-tray covers: long low boxes with joints
    for (x0, z0, x1, z1) in ((30, -23.5, 47, -23.5), (-50, 19.5, -20, 19.5), (19.5, 20, 19.5, 45), (-24.5, -12, -24.5, 22)):
        L = math.hypot(x1 - x0, z1 - z0)
        m = int(L // 3)
        for k in range(m):
            t = (k + 0.5) / m
            c = _v(x0 + (x1 - x0) * t, APRON_TOP + 0.05, z0 + (z1 - z0) * t)
            R = pg.frame_from_z(np.array([[(x1 - x0), 0, (z1 - z0)]]))[0]
            pg.box(g, "concrete", c, [0.7, 0.1, L / m - 0.06], R)
    # fire hydrants and hose reels near the trench fence
    for (x, z) in ((-50, 22), (50, 22), (-50, -22), (50, -22)):
        pg.cyl_y(g, "galv", [[x, APRON_TOP, z]], 0.16, 0.8, seg=10)
        pg.cyl_y(g, "dark_steel", [[x, APRON_TOP + 0.8, z]], 0.2, 0.1, seg=10)
        pg.tubes(g, "galv", _v(x - 0.3, APRON_TOP + 0.55, z)[None], _v(x + 0.3, APRON_TOP + 0.55, z)[None], 0.06, seg=6)
    # GSE skids: pump skids, valve panels, nitrogen bottle racks
    for (x, z, sx, sz) in ((-38, -18, 6, 3), (-38, 18, 5, 3.5), (36, -19, 4, 3), (-56, 0, 8, 4)):
        pg.box(g, "galv", [x, APRON_TOP + 1.0, z], [sx, 2.0, sz])
        pg.box(g, "dark_steel", [x, APRON_TOP + 2.05, z], [sx + 0.2, 0.1, sz + 0.2])
        for k in range(5):
            pg.tubes(g, "galv", _v(x - sx / 2 + 0.6 + k * (sx - 1.2) / 4, APRON_TOP + 2.1, z)[None],
                     _v(x - sx / 2 + 0.6 + k * (sx - 1.2) / 4, APRON_TOP + 3.3, z)[None], 0.18, seg=10)
    return g
