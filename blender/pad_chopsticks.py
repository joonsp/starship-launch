"""Chopsticks: carriage with crossbar wrapped round the tower's mount-facing corner, and the two arms swung OPEN.

World frame (three.js). The carriage collar is built tower-local and transformed; the crossbar, pivots and arms
are built directly in world coordinates. Materials: tower_paint, dark_steel, galv, grating, olm_steel (catch pads).
"""
import math

import numpy as np

import pad_geo as pg
from pad_geo import Geo
from pad_layout import (ARM_H, ARM_LEN, ARM_OPEN_DEG, ARM_PIVOT_X, ARM_PIVOT_Z, ARM_W, CARRIAGE_Y, CHORD, TOWER_C,
                        TOWER_HW, TOWER_YAW, yaw_mat)

HW = TOWER_HW
CY = CARRIAGE_Y


def _v(x, y, z):
    return np.array([x, y, z], dtype=float)


def truss_box(g, mat, p0, p1, w, h, panels, cw=0.5, bw=0.24, diag=True, cross=True):
    """A rectangular box-truss girder between p0 and p1 (centre line), section w (horizontal) x h (vertical).
    Four chords, transverse frames, X bracing on the side faces and (optionally) top/bottom faces."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    L = np.linalg.norm(d)
    z = d / L
    R = pg.frame_from_z(z[None], pg.UP)[0]
    x_ax, y_ax = R[:, 0], R[:, 1]
    corners = [(sx * w / 2, sy * h / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for cx, cy in corners:
        a = p0 + x_ax * cx + y_ax * cy
        b = p1 + x_ax * cx + y_ax * cy
        pg.beams(g, mat, a[None], b[None], cw, cw, up=y_ax)
    ts = np.linspace(0, 1, panels + 1)
    # transverse frames
    for t in ts:
        c = p0 + d * t
        for (ax0, ay0), (ax1, ay1) in zip(corners, corners[1:] + corners[:1]):
            a = c + x_ax * ax0 + y_ax * ay0
            b = c + x_ax * ax1 + y_ax * ay1
            pg.beams(g, mat, a[None], b[None], bw, bw, up=z)
    if diag:
        for k in range(panels):
            ta, tb = p0 + d * ts[k], p0 + d * ts[k + 1]
            for sx in (-1, 1):   # side faces (vertical planes at +-w/2): X
                off = x_ax * sx * w / 2
                for sgn in (1, -1):
                    a = ta + off + y_ax * (-sgn * h / 2)
                    b = tb + off + y_ax * (sgn * h / 2)
                    pg.beams(g, mat, a[None], b[None], bw * 0.9, bw * 0.9, up=x_ax)
            if cross:
                for sy in (-1, 1):   # top/bottom faces: single diagonal
                    off = y_ax * sy * h / 2
                    a = ta + off + x_ax * (-w / 2 * (1 if k % 2 else -1))
                    b = tb + off + x_ax * (w / 2 * (1 if k % 2 else -1))
                    pg.beams(g, mat, a[None], b[None], bw * 0.8, bw * 0.8, up=y_ax)
    return g


def arm_geo():
    """Right arm in ARM-LOCAL coordinates: hinge axis at the origin, +z along the arm, +x outboard (the catch rails
    are on the -x/inner face), y=0 mid-height of the truss."""
    g = Geo()
    L, W, H = ARM_LEN, ARM_W, ARM_H
    z0 = 0.8
    truss_box(g, "tower_paint", _v(0, 0, z0), _v(0, 0, L), W, H, panels=7, cw=0.6, bw=0.26)
    # hinge block and slew ring
    pg.box(g, "dark_steel", [0, 0, 0.6], [W + 0.9, H + 0.7, 2.2])
    pg.tubes(g, "dark_steel", [[0, -H / 2 - 0.7, 0]], [[0, H / 2 + 0.7, 0]], 1.5, seg=20)
    pg.tubes(g, "galv", [[0, H / 2 + 0.7, 0]], [[0, H / 2 + 0.95, 0]], 1.65, seg=20)
    # top deck grating with handrail on the outboard side
    pg.box(g, "grating", [0.1, H / 2 + 0.33, L / 2 + 0.5], [W - 0.5, 0.06, L - 1.5])
    xs = W / 2 - 0.1
    zs = np.linspace(z0 + 1.0, L - 1.0, 8)
    p0 = np.stack([np.full_like(zs, xs), np.full_like(zs, H / 2 + 0.35), zs], axis=1)
    p1 = p0.copy(); p1[:, 1] += 1.1
    pg.tubes(g, "galv", p0, p1, 0.03, seg=6)
    pg.tubes(g, "galv", [p0[0] + [0, 1.1, 0]], [p0[-1] + [0, 1.1, 0]], 0.035, seg=6)
    # catch rails on the inner (-x) face: two long rails with bumper pads (contact surfaces for the booster pins)
    for yy in (-0.9, 0.9):
        pg.beams(g, "olm_steel", _v(-W / 2 - 0.55, yy, 3.0)[None], _v(-W / 2 - 0.55, yy, L - 2.2)[None], 0.4, 0.7, up=pg.UP)
    for zz in np.linspace(3.5, L - 2.7, 6):
        pg.box(g, "dark_steel", [-W / 2 - 0.3, 0.0, zz], [0.7, 2.4, 0.3])
    # curved-ish horns at the tip: two angled plates guiding the pins in
    pg.beams(g, "olm_steel", _v(-W / 2 - 0.55, 0.9, L - 2.2)[None], _v(-W / 2 - 1.5, 1.4, L + 0.3)[None], 0.4, 0.7)
    pg.beams(g, "olm_steel", _v(-W / 2 - 0.55, -0.9, L - 2.2)[None], _v(-W / 2 - 1.5, -1.4, L + 0.3)[None], 0.4, 0.7)
    # tip: end frame and two fork legs slanting down and back (visible in the photo as dark diagonals)
    pg.box(g, "tower_paint", [0, 0, L + 0.2], [W + 0.4, H + 0.3, 0.7])
    for sx in (-1, 1):
        a = _v(sx * W / 2, H / 2, L)
        b = _v(sx * (W / 2 + 0.9), -H / 2 - 4.5, L + 1.6)
        pg.beams(g, "dark_steel", a[None], b[None], 0.55, 0.55)
        pg.box(g, "dark_steel", [sx * (W / 2 + 0.9), -H / 2 - 4.6, L + 1.6], [0.9, 0.5, 0.9])
    pg.beams(g, "dark_steel", _v(-W / 2 - 0.9, -H / 2 - 4.5, L + 1.6)[None], _v(W / 2 + 0.9, -H / 2 - 4.5, L + 1.6)[None], 0.4, 0.4)
    # underside hydraulic actuator lugs
    pg.box(g, "dark_steel", [0, -H / 2 - 0.5, 4.0], [1.2, 0.8, 1.2])
    return g


def carriage_geo():
    """Carriage collar (built tower-local, rotated to world), crossbar, V-trusses, pivots, pinion drives, actuators."""
    g = Geo()
    # ---- collar round the tower (tower-local) ----
    col = Geo()
    o = HW + CHORD / 2 + 0.95            # 6.95
    y0, y1 = CY - 2.6, CY + 2.9
    for y, hgt in ((y0, 0.9), (y1, 0.9)):
        for (a0, b0), (a1, b1) in (((-o, -o), (o, -o)), ((o, -o), (o, o)), ((o, o), (-o, o)), ((-o, o), (-o, -o))):
            pg.beams(col, "tower_paint", _v(a0, y, b0)[None], _v(a1, y, b1)[None], 1.3, hgt)
    for a, b in ((-o, -o), (o, -o), (o, o), (-o, o)):
        pg.box(col, "tower_paint", [a, (y0 + y1) / 2, b], [1.1, y1 - y0, 1.1])
    # X bracing on the collar faces
    for (a0, b0), (a1, b1) in (((-o, -o), (o, -o)), ((o, -o), (o, o)), ((o, o), (-o, o)), ((-o, o), (-o, -o))):
        pg.beams(col, "tower_paint", _v(a0, y0, b0)[None], _v(a1, y1, b1)[None], 0.35, 0.35)
        pg.beams(col, "tower_paint", _v(a0, y1, b0)[None], _v(a1, y0, b1)[None], 0.35, 0.35)
    # pinion gearboxes riding on the two rails at the (+,+) corner
    for n in ((1.0, 0.0), (0.0, 1.0)):
        base = np.array([HW + n[0] * (CHORD / 2 + 1.1), 0.0, HW + n[1] * (CHORD / 2 + 1.1)])
        for yy in (y0 + 0.3, y1 - 0.3):
            pg.box(col, "dark_steel", base + [0, yy, 0], [1.4, 1.4, 1.4])
            pg.tubes(col, "galv", base + [0, yy, 0], base + [n[0] * -0.0 + 0.0, yy, 0] + np.array([n[0], 0, n[1]]) * -0.75, 0.5, seg=12)
    # roller pads bearing on the other two faces of the chords
    for a, b in ((-o + 0.5, o - 0.4), (o - 0.4, -o + 0.5)):
        pg.box(col, "dark_steel", [a, CY, b], [0.5, 1.0, 0.5])
    g.extend(col, pg.M4(pg.rot_y(TOWER_YAW), TOWER_C))

    # ---- crossbar (world frame) ----
    zc = ARM_PIVOT_Z - 0.6
    xh = ARM_PIVOT_X + 1.6
    truss_box(g, "tower_paint", _v(-xh, CY, zc), _v(xh, CY, zc), 3.4, 5.0, panels=8, cw=0.6, bw=0.26)
    # V-trusses from crossbar to the collar's south corner
    corner = TOWER_C + yaw_mat(TOWER_YAW) @ _v(HW + 1.2, 0, HW + 1.2)
    for sx in (-1, 1):
        a = _v(sx * 5.5, CY, zc - 1.7)
        b = _v(corner[0] + sx * 0.7, CY, corner[2] + 0.6)
        truss_box(g, "tower_paint", a, b, 2.6, 4.2, panels=4, cw=0.5, bw=0.22, cross=False)
    # pivot housings (slew bearings) on the crossbar ends and their pins
    for sx in (-1, 1):
        cx = sx * ARM_PIVOT_X
        pg.box(g, "dark_steel", [cx, CY, ARM_PIVOT_Z - 1.2], [4.6, 5.6, 3.4])
        pg.tubes(g, "dark_steel", [[cx, CY - 3.1, ARM_PIVOT_Z]], [[cx, CY + 3.1, ARM_PIVOT_Z]], 1.55, seg=20)
        pg.tubes(g, "galv", [[cx, CY + 3.1, ARM_PIVOT_Z]], [[cx, CY + 3.4, ARM_PIVOT_Z]], 1.15, seg=20)
    # walkway along the crossbar with railing
    pg.box(g, "grating", [0, CY + 2.83, zc], [2 * xh - 2.0, 0.06, 2.6])
    xs = np.linspace(-xh + 1.5, xh - 1.5, 14)
    for zz in (zc - 1.3, zc + 1.3):
        p0 = np.stack([xs, np.full_like(xs, CY + 2.85), np.full_like(xs, zz)], axis=1)
        p1 = p0.copy(); p1[:, 1] += 1.1
        pg.tubes(g, "galv", p0, p1, 0.03, seg=6)
        pg.tubes(g, "galv", [p0[0] + [0, 1.1, 0]], [p0[-1] + [0, 1.1, 0]], 0.035, seg=6)
    return g


def actuators_geo():
    """Hydraulic-style slew actuators between the crossbar and each open arm (two telescoping tubes)."""
    g = Geo()
    for sx in (-1, 1):
        ph = math.radians(ARM_OPEN_DEG) * sx
        d = _v(math.sin(ph), 0, math.cos(ph))
        piv = _v(sx * ARM_PIVOT_X, CY - 1.4, ARM_PIVOT_Z)
        a = _v(sx * (ARM_PIVOT_X - 1.0), CY - 2.2, ARM_PIVOT_Z - 3.2)          # anchor on the crossbar
        b = piv + d * 4.2 + _v(0, -0.3, 0)                                        # clevis on the arm
        m = a + (b - a) * 0.55
        pg.tubes(g, "galv", a[None], m[None], 0.34, seg=12)
        pg.tubes(g, "dark_steel", m[None], b[None], 0.2, seg=10)
        pg.spheres(g, "dark_steel", np.array([a, b]), 0.42, seg=10, rings=6)
    return g


def arms_geo():
    """Both arms placed in the world, swung open by ARM_OPEN_DEG."""
    right = arm_geo()
    left = Geo().extend(right, np.diag([-1.0, 1.0, 1.0, 1.0]))   # mirror across x (extend fixes the winding)
    g = Geo()
    ph = ARM_OPEN_DEG
    g.extend(right, pg.M4(pg.rot_y(ph), [ARM_PIVOT_X, CY + 0.2, ARM_PIVOT_Z]))
    g.extend(left, pg.M4(pg.rot_y(-ph), [-ARM_PIVOT_X, CY + 0.2, ARM_PIVOT_Z]))
    return g
