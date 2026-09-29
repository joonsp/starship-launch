"""Super Heavy B21 (Block 3) body parts, vehicle frame: origin on the axis at the engine plane, y up.

Every part is authored in absolute vehicle coordinates and exported with an identity transform, so the
three.js shaders can read `vSlObjPos` as vehicle-frame position (height above the engine plane, azimuth).
Azimuth convention (same as engine-layout.ts): degrees from +x toward -z (x = r cos a, z = -r sin a).
"""
import math

import numpy as np
from mathutils import Matrix, Vector

from vehicle_geo import (TAU, Geo, catmull, cylinder, disc, frame_between, mat_ry, mat_t, polygon, rbox,
                         revolve_profile, surface, torus_ring, tube)

R = 4.5
BOOSTER_MAT = "steel_booster"
DARK_MAT = "booster_dark"


def seam_rows(y_a, y_b, seams, r=R, amp=0.006, hw=0.02, extra=()):
    """Profile rows for a straight shell between y_a and y_b with weld beads at `seams`."""
    ys = {y_a, y_b}
    for s in seams:
        if y_a < s < y_b:
            for k in (-3, -2, -1, 0, 1, 2, 3):
                ys.add(round(s + k * hw, 5))
    for y in extra:
        ys.add(round(y, 5))
    ys = sorted(y for y in ys if y_a <= y <= y_b)
    rows = []
    for y in ys:
        d = 0.0
        for s in seams:
            d = max(d, amp * math.exp(-((y - s) / (hw * 1.4)) ** 2))
        rows.append((r + d, y))
    return rows


def booster_seams():
    seams = [1.4, 2.8, 4.2, 5.6]
    y = 5.6 + 1.83
    while y < 62.0:
        seams.append(round(y, 4))
        y += 1.83
    return seams


def azimuth_frame(az_deg, y=0.0):
    """Matrix taking local (x tangent, y up, z outward) to the vehicle frame at azimuth az."""
    return mat_t(0, y, 0) @ mat_ry(az_deg + 90.0)


# ---------------------------------------------------------------- hull, skirt, dome

def build_hull():
    seams = booster_seams()
    rows = seam_rows(5.6, 62.0, seams)
    return revolve_profile(rows, nu=144, mat=BOOSTER_MAT, uvscale=20.0)


def build_skirt():
    """Aft skirt 0..5.6 m: outer wall, rolled lip, inner wall up to the thrust plate (3.2 m)."""
    seams = [1.4, 2.8, 4.2]
    rc = 0.11
    rows = list(seam_rows(rc, 5.6, seams)[::-1])                    # outer wall, top -> bottom
    for a in np.linspace(0.0, math.pi, 10)[1:]:                     # rolled lip: outside -> underside -> inside
        rows.append((R - rc + rc * math.cos(a), rc - rc * math.sin(a)))
    ri = R - 2 * rc
    rows += [(ri, 0.5), (ri, 1.8), (ri, 3.2)]                      # inner wall going up
    return revolve_profile(rows, nu=144, mat=BOOSTER_MAT, ref_row=0)


def build_dome():
    """Forward tank dome (2:1 ellipsoid) welded at 62 m, visible through the open truss."""
    rows = []
    h = 2.5
    for a in np.linspace(0.0, math.pi / 2, 14):
        rows.append((R * math.cos(a) - 0.001, 62.0 + h * math.sin(a)))
    rows[-1] = (0.02, 62.0 + h)
    return revolve_profile(rows, nu=96, mat=BOOSTER_MAT)


# ---------------------------------------------------------------- engine bay hardware

def build_engine_bay():
    """Thrust plate, LOX/CH4 feed manifolds and structure seen when looking up between the bells."""
    g = Geo()
    g += disc(3.2, R - 0.22, 96, DARK_MAT, up=False)
    # main feed manifolds (torus lines that thread between the engine rings)
    g += torus_ring(2.95, 3.2, 0.16, nu=96, nv=10, mat=BOOSTER_MAT)
    g += torus_ring(2.95, 1.65, 0.13, nu=72, nv=10, mat=BOOSTER_MAT)
    # radial spokes from the ring manifolds (between engine columns)
    for i in range(12):
        a = math.radians(i * 30 + 15)
        p0 = (1.65 * math.cos(a), 2.95, -1.65 * math.sin(a))
        p1 = (3.2 * math.cos(a), 2.95, -3.2 * math.sin(a))
        g += cylinder(p0, p1, 0.06, 0.06, 10, BOOSTER_MAT)
        p2 = (4.3 * math.cos(a), 2.95, -4.3 * math.sin(a))
        g += cylinder(p1, p2, 0.06, 0.06, 10, BOOSTER_MAT)
    # structural ribs on the plate rim
    for i in range(24):
        a = math.radians(i * 15)
        c = Vector((4.2 * math.cos(a), 3.0, -4.2 * math.sin(a)))
        b = rbox((0.15, 0.4, 0.5), 0.02, DARK_MAT)
        M = mat_t(*c) @ mat_ry(math.degrees(a) + 90.0)
        g += b.transformed(M)
    return g


# ---------------------------------------------------------------- hot-stage ring / open truss

def build_hotstage():
    g = Geo()
    y_lo0, y_lo1 = 62.0, 64.3
    y_hi0, y_hi1 = 71.15, 72.3
    # lower solid ring (the fin mounts and catch pins live here)
    rows = [(R, y_lo0), (R + 0.02, y_lo0 + 0.1), (R + 0.02, y_lo1 - 0.1), (R, y_lo1)]
    g += revolve_profile([(R, y_lo0), (R + 0.03, y_lo0 + 0.06), (R + 0.03, y_lo1 - 0.06), (R, y_lo1)], nu=144, mat=BOOSTER_MAT,
                         strips=[(0, 3)])
    g += disc(y_lo1, R, 96, BOOSTER_MAT, up=True, r_in=R - 0.5)
    # upper ring with vent bays
    g += revolve_profile([(R, y_hi0), (R + 0.03, y_hi0 + 0.06), (R + 0.03, y_hi1 - 0.06), (R, y_hi1)], nu=144, mat=BOOSTER_MAT)
    g += disc(y_hi1, R, 96, BOOSTER_MAT, up=True, r_in=R - 0.35)
    g += disc(y_hi0, R, 96, BOOSTER_MAT, up=False, r_in=R - 0.35)
    n_vent = 12
    for i in range(n_vent):
        a = i * 360.0 / n_vent + 15.0
        M = mat_t(0, 0, 0) @ mat_ry(a + 90.0)
        vent = rbox((1.5, 0.62, 0.10), 0.03, DARK_MAT).transformed(mat_t(0, 71.72, R + 0.03))
        g += vent.transformed(mat_ry(a + 90.0))
        # louvre slats inside each vent
        for k in range(4):
            sl = rbox((1.32, 0.05, 0.05), 0.01, BOOSTER_MAT).transformed(mat_t(0, 71.54 + 0.12 * k, R + 0.085))
            g += sl.transformed(mat_ry(a + 90.0))
    # truss: posts and X bracing in the open bays
    n_post = 16
    yb0, yb1 = y_lo1, y_hi0
    rp = R - 0.18
    posts = []
    for i in range(n_post):
        a = i * 360.0 / n_post
        ar = math.radians(a)
        c = (rp * math.cos(ar), (yb0 + yb1) / 2, -rp * math.sin(ar))
        p = rbox((0.30, yb1 - yb0, 0.30), 0.04, BOOSTER_MAT).transformed(mat_t(*c) @ mat_ry(a + 90.0))
        g += p
        posts.append(a)
    for i in range(n_post):
        a0 = math.radians(posts[i])
        a1 = math.radians(posts[(i + 1) % n_post])
        p_lo0 = (rp * math.cos(a0), yb0 + 0.1, -rp * math.sin(a0))
        p_hi0 = (rp * math.cos(a0), yb1 - 0.1, -rp * math.sin(a0))
        p_lo1 = (rp * math.cos(a1), yb0 + 0.1, -rp * math.sin(a1))
        p_hi1 = (rp * math.cos(a1), yb1 - 0.1, -rp * math.sin(a1))
        g += cylinder(p_lo0, p_hi1, 0.075, 0.075, 8, BOOSTER_MAT)
        g += cylinder(p_lo1, p_hi0, 0.075, 0.075, 8, BOOSTER_MAT)
    # mid ring tube
    g += torus_ring((yb0 + yb1) / 2, rp, 0.09, nu=96, nv=8, mat=BOOSTER_MAT)
    return g


# ---------------------------------------------------------------- grid fins

def gridfin_local(w=2.7, l=3.6, t=0.52, cells_w=9, cells_l=12, web=0.022, frame=0.11):
    """Grid fin lattice in a local frame: x tangent (chord), z radial (span, outward), y vertical (cell depth).

    The photo shows the fins as thin horizontal dashes sticking out of the booster near the top: the lattice
    plane is perpendicular to the stack axis and the cells are open along the axis."""
    g = Geo()
    m = BOOSTER_MAT
    zc = l / 2
    # outer frame: root and tip bars along x, side bars along z (the tip bar is taller: the fin's leading edge)
    g += rbox((w, t, frame), 0.02, m, (0, 0, -zc + frame / 2))
    g += rbox((w, t * 1.15, frame * 1.4), 0.03, m, (0, 0, zc - frame * 0.7))
    g += rbox((frame, t, l - 2 * frame), 0.02, m, (w / 2 - frame / 2, 0, 0))
    g += rbox((frame, t, l - 2 * frame), 0.02, m, (-w / 2 + frame / 2, 0, 0))
    iw = w - 2 * frame
    il = l - 2 * frame
    for i in range(1, cells_w):
        x = -iw / 2 + iw * i / cells_w
        g += rbox((web, t * 0.96, il), 0.004, m, (x, 0, 0))
    for j in range(1, cells_l):
        z = -il / 2 + il * j / cells_l
        g += rbox((iw, t * 0.96, web), 0.004, m, (0, 0, z))
    return g


def build_gridfin(az_deg, y_hinge, span=3.6):
    """One V3 grid fin at azimuth az_deg: a horizontal lattice plate radiating from the hull with a hinge
    housing on the trunk. span = radial length of the fin."""
    g = Geo()
    fin = gridfin_local(w=2.7, l=span, t=0.52)
    z_root = R - 0.45                                  # root bar sits just inside the skin line
    L = azimuth_frame(az_deg, y_hinge)
    g += fin.transformed(L @ mat_t(0, 0, z_root + span / 2))
    # hinge housing (blocky fairing on the hull) with the hinge shaft running radially into the fin
    pod = Geo()
    pod += rbox((1.5, 1.05, 0.62), 0.10, BOOSTER_MAT, (0, 0, 0.0))
    pod += cylinder((0, 0, -0.3), (0, 0, 1.4), 0.23, 0.21, 16, BOOSTER_MAT)          # hinge shaft, radial
    pod += rbox((0.9, 0.5, 0.3), 0.06, DARK_MAT, (0, 0, 0.62))                          # actuator cover
    g += pod.transformed(L @ mat_t(0, 0, R + 0.28))
    # fairing strips blending the housing into the hull
    for sx in (-0.85, 0.85):
        g += rbox((0.16, 1.15, 0.45), 0.04, BOOSTER_MAT).transformed(L @ mat_t(sx, 0, R + 0.10))
    return g


# ---------------------------------------------------------------- catch pins, raceways, details

def build_catch_pin(az_deg, y=64.0):
    g = Geo()
    L = azimuth_frame(az_deg, y)
    base = rbox((1.0, 0.9, 0.34), 0.06, BOOSTER_MAT).transformed(L @ mat_t(0, 0, R + 0.10))
    g += base
    shaft = cylinder((0, 0, R + 0.2), (0, 0, R + 1.05), 0.33, 0.30, 24, BOOSTER_MAT)
    g += shaft.transformed(L)
    cone = cylinder((0, 0, R + 1.05), (0, 0, R + 1.28), 0.30, 0.16, 24, BOOSTER_MAT)
    g += cone.transformed(L)
    return g


def build_raceway(az_deg, y0=6.4, y1=61.4, w=0.6, hgt=0.30, pitch=1.83):
    """Cable raceway: rounded cover segments with a bracket at every weld ring."""
    g = Geo()
    L = azimuth_frame(az_deg, 0.0)
    y = y0
    while y + pitch * 0.85 < y1:
        seg = rbox((w, pitch * 0.9, hgt), 0.05, BOOSTER_MAT).transformed(mat_t(0, y + pitch * 0.45, R + hgt / 2 - 0.02))
        g += seg.transformed(L)
        br = rbox((w + 0.16, 0.16, hgt + 0.05), 0.03, DARK_MAT).transformed(mat_t(0, y + pitch * 0.95, R + hgt / 2))
        g += br.transformed(L)
        y += pitch
    # fairing end caps (tapered noses)
    for yy, s in ((y0 - 0.25, 1), (y - pitch * 0.08 + 0.25, -1)):
        nose = rbox((w * 0.8, 0.5, hgt * 0.7), 0.1, BOOSTER_MAT).transformed(mat_t(0, yy, R + hgt * 0.32))
        g += nose.transformed(L)
    return g


def build_details():
    """QD plates, vents, lower-section fairings (chines)."""
    g = Geo()
    # quick-disconnect plates: recessed-look panels with ports
    for az, y in ((205.0, 9.0), (40.0, 12.5)):
        L = azimuth_frame(az, y)
        g += rbox((1.7, 1.25, 0.10), 0.03, DARK_MAT).transformed(L @ mat_t(0, 0, R + 0.05))
        for px in (-0.5, 0.0, 0.5):
            for py in (-0.28, 0.28):
                g += cylinder((px, py, R + 0.09), (px, py, R + 0.20), 0.13, 0.11, 14, BOOSTER_MAT).transformed(L)
        g += rbox((1.9, 0.08, 0.14), 0.02, BOOSTER_MAT).transformed(L @ mat_t(0, 0.68, R + 0.06))
    # ground-side fill/drain umbilical panel near the skirt
    L = azimuth_frame(300.0, 6.2)
    g += rbox((1.3, 0.9, 0.09), 0.03, DARK_MAT).transformed(L @ mat_t(0, 0, R + 0.045))
    g += cylinder((0, 0, R + 0.08), (0, 0, R + 0.32), 0.25, 0.22, 20, BOOSTER_MAT).transformed(L)
    # vent stacks along the skirt (round louvred covers)
    for az in (90.0, 150.0, 330.0):
        L = azimuth_frame(az, 4.6)
        g += cylinder((0, 0, R), (0, 0, R + 0.16), 0.32, 0.30, 20, DARK_MAT).transformed(L)
    # aft chines: shallow tapered fairings around the skirt, 6 of them
    for i in range(6):
        az = i * 60.0 + 30.0
        L = azimuth_frame(az, 0.0)
        for k in range(4):
            y = 0.5 + 0.62 * k
            hh = 0.32 - 0.05 * k
            g += rbox((0.62, 0.6, hh), 0.08, BOOSTER_MAT).transformed(L @ mat_t(0, y + 0.3, R + hh / 2 - 0.02))
    return g
