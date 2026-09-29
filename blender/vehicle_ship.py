"""Starship S41 (Block 3) body parts, vehicle frame (ship base at y = SH0 = booster length).

The ship's tiled windward belly faces -z (azimuth 90 in the from-+x-toward--z convention). The tile
pattern itself is a shader (src/vehicle/materials.ts); the mesh only carries the geometry. Flaps sit at
+-x (azimuth 0 and 180). Object names: ship_skirt, ship_hull, ship_nose, ship_engine_bay,
flap_fwd_L/R, flap_aft_L/R, ship_details, ship_raceway_0/1.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

from vehicle_booster import azimuth_frame
from vehicle_geo import (TAU, Geo, Chunk, catmull, cylinder, disc, mat_rx, mat_ry, mat_t, polygon, rbox,
                         revolve_profile, surface, torus_ring, tube, _norm)

R = 4.5
SHIP = "steel_ship"
FLAP = "flap"
DARK = "ship_dark"
SH0 = 72.3            # ship base height in the vehicle frame (overridden by build_vehicle from the spec)
PLATE_Y = 3.4         # ship thrust plate height above the ship base


def _rows_shell(y_a, y_b, seams, amp=0.006, hw=0.02):
    ys = {y_a, y_b}
    for s in seams:
        if y_a < s < y_b:
            for k in (-3, -2, -1, 0, 1, 2, 3):
                ys.add(round(s + k * hw, 5))
    ys = sorted(y for y in ys if y_a <= y <= y_b)
    rows = []
    for y in ys:
        d = 0.0
        for s in seams:
            d = max(d, amp * math.exp(-((y - s) / (hw * 1.4)) ** 2))
        rows.append((R + d, SH0 + y))
    return rows


def ship_seams():
    seams = []
    y = PLATE_Y
    while y < 42.5:
        seams.append(round(y, 4))
        y += 1.83
    return seams


def build_skirt():
    """Aft skirt 0..3.4 (ship-relative): outer wall, rolled lip, inner wall to the thrust plate."""
    rc = 0.10
    rows = list(_rows_shell(rc, PLATE_Y, [1.7, PLATE_Y])[::-1])
    for a in np.linspace(0.0, math.pi, 10)[1:]:
        rows.append((R - rc + rc * math.cos(a), SH0 + rc - rc * math.sin(a)))
    ri = R - 2 * rc
    rows += [(ri, SH0 + 0.6), (ri, SH0 + PLATE_Y)]
    return revolve_profile(rows, nu=144, mat=SHIP, ref_row=0)


def build_hull():
    return revolve_profile(_rows_shell(PLATE_Y, 42.5, ship_seams()), nu=144, mat=SHIP)


def nose_profile(n=48):
    """Nose cone, R=4.5, L=9.6, blunt tip (r=0.3 over ~0.25 m). The photo shows a slimmer, near-conical
    silhouette than the tangent-ogive estimate of vehicle.md (6.8 m wide 7.6 m below the tip, an ogive gives 8.4):
    r = R (x/L)^0.85, blended into the cylinder over the last 2.4 m so it stays tangent to the hull.
    Returns rows [(r, y)] base -> tip (vehicle frame)."""
    L = 9.6
    p_exp = 0.85

    def r_at(xt):  # xt = distance from the tip
        k = (max(xt, 1e-4) / L) ** p_exp * R
        blend = min(max((xt - (L - 2.4)) / 2.4, 0.0), 1.0)
        blend = blend * blend * (3 - 2 * blend)
        return k * (1 - blend) + R * blend * (1 - 0.0) if blend > 0 else k

    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if r_at(mid) < 0.3:
            lo = mid
        else:
            hi = mid
    xt0 = hi
    top = SH0 + 52.1
    base = SH0 + 42.5
    # denser near the tip and near the base blend
    xs = np.concatenate([np.linspace(L, L - 2.6, 12), np.linspace(L - 2.6, xt0, n)[1:]])
    rows = []
    for xt in xs:
        rows.append((r_at(xt), top - xt + 0.13))
    r0, y0 = rows[-1]
    cap_h = 0.13
    for a in np.linspace(0.0, math.pi / 2, 7)[1:]:
        rows.append((r0 * math.cos(a), y0 + cap_h * math.sin(a)))
    rows[-1] = (0.004, rows[-1][1])
    rows[0] = (R, base)
    return rows


def build_nose():
    return revolve_profile(nose_profile(), nu=144, mat=SHIP)


# ---------------------------------------------------------------- thrust plate and engines mount

def build_engine_bay():
    g = Geo()
    y = SH0 + PLATE_Y
    g += disc(y, R - 0.2, 96, DARK, up=False)
    g += torus_ring(y - 0.25, 2.5, 0.14, nu=72, nv=10, mat=SHIP)
    for i in range(6):
        a = math.radians(i * 60 + 30)
        g += cylinder((1.8 * math.cos(a), y - 0.25, -1.8 * math.sin(a)), (3.3 * math.cos(a), y - 0.25, -3.3 * math.sin(a)), 0.055, 0.055, 10, SHIP)
    return g


# ---------------------------------------------------------------- flaps

def slab(outline, thick, chamfer, mat, frame, cen_shift=0.0):
    """Convex outline [(u, v)] extruded to `thick` (w axis) with chamfered edges, flat shaded.

    frame = 4x4 matrix mapping (u, v, w) -> vehicle frame."""
    O = np.asarray(outline, dtype=np.float64)
    K = len(O)
    c = O.mean(axis=0)
    inset = []
    for i in range(K):
        p = O[i]
        d = c - p
        d = d / max(np.linalg.norm(d), 1e-9)
        inset.append(p + d * chamfer * 1.5)
    I = np.array(inset)
    t2 = thick / 2
    polys = []
    polys.append([(p[0], p[1], t2) for p in I])
    polys.append([(p[0], p[1], -t2) for p in I])
    for i in range(K):
        j = (i + 1) % K
        polys.append([(O[i][0], O[i][1], t2 - chamfer), (O[j][0], O[j][1], t2 - chamfer),
                      (O[j][0], O[j][1], -t2 + chamfer), (O[i][0], O[i][1], -t2 + chamfer)])
        polys.append([(I[i][0], I[i][1], t2), (I[j][0], I[j][1], t2), (O[j][0], O[j][1], t2 - chamfer), (O[i][0], O[i][1], t2 - chamfer)])
        polys.append([(I[i][0], I[i][1], -t2), (I[j][0], I[j][1], -t2), (O[j][0], O[j][1], -t2 + chamfer), (O[i][0], O[i][1], -t2 + chamfer)])
    cen = np.array([c[0], c[1], 0.0])
    # cap polygons (K-gons) were added as fans of K verts: triangulate as a fan
    Ps2, Ns2, Fs2, base = [], [], [], 0
    for poly in polys:
        p = np.array(poly)
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if n @ (p.mean(axis=0) - cen) < 0:
            p = p[::-1]
            n = -n
        n = n / max(np.linalg.norm(n), 1e-12)
        k = len(p)
        Ps2.append(p)
        Ns2.append(np.tile(n, (k, 1)))
        for q in range(1, k - 1):
            Fs2.append([base, base + q, base + q + 1])
        base += k
    g = Geo([Chunk(np.vstack(Ps2), np.vstack(Ns2), np.zeros((base, 2)), np.array(Fs2), mat)])
    return g.transformed(frame)


def fairing(centre, length, a, b, rows=14, nu=24, mat=SHIP, bulge=1.0):
    """Streamlined hinge fairing: cross-section ellipse (a along x, b along z), long axis along y."""
    cx, cy, cz = centre

    def pos(U, t):
        s = math.sin(math.pi * t) ** 0.6 * bulge
        ang = TAU * U
        return np.stack([cx + a * s * np.cos(ang), np.full_like(U, cy - length / 2 + length * t), cz + b * s * np.sin(ang)], axis=1)
    ts = [0.0005 + 0.999 * i / rows for i in range(rows + 1)]
    return surface(pos, ts, nu, mat=mat, radial_axis=(cx, cz), ref_row=rows // 2)


def flap_frame(sx, y0, psi_deg):
    """Hinge on the hull side (x = sx R) at height y0; the panel swings about the vertical hinge line
    from the belly plane (psi 0 = flat in the x-y plane) toward the leeward side by psi degrees."""
    S = Matrix(((sx, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
    return mat_t(sx * R, y0, 0) @ mat_ry(-sx * psi_deg) @ S


def build_aft_flap(sx):
    """sx = +1 -> flap_aft_L (+x side), -1 -> R. Spec size 9 x 4 m. In the photo the flaps are flat-bottomed
    trapezoids at the ship base (about 11 m tall, ~3.6 m proud of the hull): swung 25 deg off the belly plane."""
    g = Geo()
    out = 4.0
    o = [(-0.25, 0.7), (out, 0.7), (out, 7.6), (-0.25, 10.8)]           # (outboard distance, ship y)
    M = flap_frame(sx, SH0, 25.0)
    g += slab(o, 0.55, 0.09, FLAP, M)
    for yy in (1.9, 8.6):                                                 # actuator / hinge housings
        g += rbox((0.8, 1.0, 0.7), 0.1, SHIP, (sx * (R + 0.15), SH0 + yy, 0.0))
    g += fairing((sx * (R + 0.20), SH0 + 2.0, 0.0), 2.6, 0.75, 0.62, mat=SHIP)     # aerocovers
    g += fairing((sx * (R + 0.20), SH0 + 9.0, 0.0), 2.2, 0.62, 0.55, mat=SHIP)
    return g


def build_fwd_flap(sx):
    """Forward flap, spec 5.5 x 2.5 m. The photo shows small swept wings at the nose base with a flat lower
    edge at ship y ~41 (they are extended on ascent): nearly in the belly plane."""
    g = Geo()
    out = 3.1                                             # ~3 m proud of the hull in the photo (row 248: 14.6 m tip to tip)
    o = [(-0.25, 41.0), (out, 41.0), (out, 42.5), (-0.25, 46.6)]
    M = flap_frame(sx, SH0, 8.0)
    g += slab(o, 0.42, 0.07, FLAP, M)
    for yy in (41.9, 44.6):
        g += rbox((0.6, 0.7, 0.55), 0.08, SHIP, (sx * (R + 0.1), SH0 + yy, 0.0))
    g += fairing((sx * (R + 0.16), SH0 + 42.5, 0.0), 2.2, 0.55, 0.5, mat=SHIP)
    return g


# ---------------------------------------------------------------- raceways and details

def build_raceway(az_deg, y0=5.0, y1=41.0, w=0.5, hgt=0.26, pitch=1.83):
    g = Geo()
    L = azimuth_frame(az_deg, 0.0)
    y = y0
    while y + pitch * 0.85 < y1:
        seg = rbox((w, pitch * 0.9, hgt), 0.05, SHIP).transformed(mat_t(0, SH0 + y + pitch * 0.45, R + hgt / 2 - 0.02))
        g += seg.transformed(L)
        br = rbox((w + 0.14, 0.14, hgt + 0.05), 0.03, DARK).transformed(mat_t(0, SH0 + y + pitch * 0.95, R + hgt / 2))
        g += br.transformed(L)
        y += pitch
    return g


def build_details():
    g = Geo()
    # payload door outline on the leeward side (az 270): raised panel with hinge blocks and latch line
    L = azimuth_frame(270.0, SH0)
    for (w, h, x, y) in ((3.9, 0.09, 0.0, 42.45), (3.9, 0.09, 0.0, 37.95), (0.09, 4.5, -1.95, 40.2), (0.09, 4.5, 1.95, 40.2), (0.07, 4.5, 0.0, 40.2)):
        g += rbox((w, h, 0.05), 0.015, SHIP).transformed(L @ mat_t(x, y, R + 0.005))
    for hx in (-1.4, 0.0, 1.4):
        g += rbox((0.5, 0.35, 0.16), 0.03, DARK).transformed(L @ mat_t(hx, 42.2, R + 0.05))
    # quick-disconnect / refuelling plate near the forward tank end (az 200)
    L = azimuth_frame(200.0, SH0)
    g += rbox((1.5, 1.1, 0.10), 0.03, DARK).transformed(L @ mat_t(0, 41.5, R + 0.05))
    for px in (-0.4, 0.0, 0.4):
        g += cylinder((px, 41.5, R + 0.09), (px, 41.5, R + 0.19), 0.12, 0.10, 14, SHIP).transformed(L)
    # header tank vent fairings at the nose shoulder
    for az in (215.0, 325.0):
        L = azimuth_frame(az, SH0)
        g += rbox((0.55, 1.6, 0.30), 0.10, SHIP).transformed(L @ mat_t(0, 44.0, 4.45 - 0.1))
    # ring band vents near the aft skirt (dark louvres)
    for az in (20.0, 140.0, 260.0):
        L = azimuth_frame(az, SH0)
        g += rbox((0.9, 0.5, 0.08), 0.02, DARK).transformed(L @ mat_t(0, 2.3, R + 0.03))
    return g
