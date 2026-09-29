"""Raptor 3 engine models (engine-local frame: origin on the engine axis at the engine plane, y up).

Materials (roles, see src/vehicle/materials.ts):
  engine_bell   regen-cooled bell nozzle (ribbed), heat-tinted rim
  engine_steel  chamber, powerhead, turbopumps, plumbing (bright stainless / Inconel)
  engine_dark   gimbal actuators, mount hardware, shielding

Raptor 3 has a clean "no shroud" look: bare bell with regen-channel ribbing, a compact powerhead
and chamber, a short gimbal mount. Three variants are built (each with a high and a low LOD):
  sl_fixed   booster outer ring (20 engines, rigid mount)
  sl_gimbal  booster inner 13 engines and the ship's 3 RSL (two gimbal actuators)
  rvac       ship vacuum engine, 2.4 m exit, corrugated radiation-cooled extension
"""
import math

import numpy as np

from vehicle_geo import (TAU, Geo, catmull, cylinder, disc, mat_ry, mat_t, rbox, revolve_profile,
                         surface, torus_ring, tube)


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def bell_rows(y_e, r_e, y_t, r_t, expo, n, hoops=(), lip=0.03, wall=0.014, ribs_from=0.08):
    """Rows [(r, y, w, kind)] going outer wall (throat -> exit), lip roll, inner wall (exit -> throat).

    w = rib weight (0 = smooth). hoops = ((y_centre, amplitude, half_width), ...) stiffening bands.
    """
    ts = np.linspace(0, 1, n) ** 1.5
    ys = list(y_t - ts * (y_t - y_e))
    for (yc, amp, hw) in hoops:
        for k in (-1.0, 0.0, 1.0):
            ys.append(yc + k * hw * 0.6)
    ys = sorted(set(round(y, 5) for y in ys if y_e <= y <= y_t), reverse=True)

    def rr(y):
        t = (y_t - y) / (y_t - y_e)
        r = r_t + (r_e - r_t) * t ** expo
        for (yc, amp, hw) in hoops:
            r += amp * math.exp(-((y - yc) / hw) ** 2)
        return r

    def rib_w(y):
        t = (y_t - y) / (y_t - y_e)
        return float(_smoothstep(0.03, 0.15, t) * (1.0 - _smoothstep(1.0 - ribs_from, 1.0, t)))

    rows = [(rr(y) + 0.0, y, rib_w(y)) for y in ys]
    # lip roll: outer exit -> below -> inner exit
    r0 = rows[-1][0]
    y0 = rows[-1][1]
    for a in np.linspace(0, math.pi, 7)[1:-1]:
        rows.append((r0 - lip / 2 + (lip / 2) * math.cos(a), y0 - (lip / 2) * math.sin(a), 0.0))
    inner_ys = ys[::2] if ys[-1] in ys[::2] else ys[::2] + [ys[-1]]
    inner = [(max(rr(y) - wall, 0.02), y, 0.0) for y in reversed(inner_ys)]
    rows += inner
    return rows


def bell_geo(y_e, r_e, y_t, r_t, expo=0.58, n=44, nribs=48, rib_amp=0.0045, cols=192, hoops=(), mat="engine_bell",
             corrugation=None):
    rows = bell_rows(y_e, r_e, y_t, r_t, expo, n, hoops)

    def pos(U, row):
        r, y, w = row
        a = TAU * U
        rib = np.clip(np.cos(nribs * a) * 1.6, -1.0, 1.0) * 0.5 + 0.5
        rad = r + rib_amp * w * rib
        return np.stack([rad * np.cos(a), np.full_like(U, y), -rad * np.sin(a)], axis=1)

    return surface(pos, rows, cols, mat=mat, ref_row=0,
                   uv=lambda U, row, P: np.stack([U, np.full_like(U, row[1] * 0.3)], axis=1))


def chamber_geo(y_t, r_t, y_top, r_ch=0.24, mat="engine_steel"):
    """Convergent section, cylinder and dome above the throat."""
    rows = [(r_t, y_t)]
    y_cyl0 = y_t + (y_top - y_t) * 0.30
    for t in np.linspace(0, 1, 8)[1:]:
        s = t * t * (3 - 2 * t)
        rows.append((r_t + (r_ch - r_t) * s, y_t + (y_cyl0 - y_t) * t))
    y_cyl1 = y_top - 0.22
    rows.append((r_ch, y_cyl1))
    for a in np.linspace(0, math.pi / 2, 8)[1:]:
        rows.append((max(r_ch * math.cos(a), 0.012), y_cyl1 + 0.22 * math.sin(a)))
    return revolve_profile(rows, nu=32, mat=mat)


def powerhead(y_top_chamber, y_mount, gimbal=True, scale=1.0, lod=0):
    """Turbopumps, preburners, plumbing and mount, engine-local. y_top_chamber = top of the chamber dome."""
    g = Geo()
    yc = y_top_chamber
    seg = 20 if lod == 0 else 8
    # regen manifold ring around the chamber
    if lod == 0:
        g += torus_ring(yc - 0.95, 0.27, 0.032, nu=40, nv=8, mat="engine_steel")
        g += torus_ring(yc - 0.62, 0.285, 0.02, nu=40, nv=8, mat="engine_steel")
    # turbopumps (vertical cylinders either side of the chamber) with volutes
    g += cylinder((-0.36, yc - 0.55, 0.0), (-0.36, yc + 0.25, 0.0), 0.135, 0.12, seg, "engine_steel")
    g += cylinder((0.37, yc - 0.75, 0.0), (0.37, yc + 0.15, 0.0), 0.16, 0.14, seg, "engine_steel")
    if lod == 0:
        g += torus_ring(yc - 0.5, 0.135, 0.05, nu=28, nv=8, mat="engine_steel", cx=-0.36)
        g += torus_ring(yc - 0.70, 0.16, 0.055, nu=28, nv=8, mat="engine_steel", cx=0.37)
        # preburners
        g += cylinder((0.0, yc - 0.55, 0.34), (0.0, yc + 0.05, 0.34), 0.085, 0.085, 14, "engine_steel")
        g += cylinder((0.0, yc - 0.45, -0.34), (0.0, yc + 0.02, -0.34), 0.075, 0.075, 14, "engine_steel")
        # pump caps
        g += rbox((0.30, 0.09, 0.30), 0.02, "engine_dark", (-0.36, yc + 0.30, 0.0))
        g += rbox((0.34, 0.09, 0.34), 0.02, "engine_dark", (0.37, yc + 0.20, 0.0))
        # plumbing: smooth pipes joining pumps, preburners and the injector dome
        for pts, r in [
            ([(-0.36, yc + 0.28, 0.0), (-0.30, yc + 0.42, 0.10), (-0.10, yc + 0.34, 0.08), (0.0, yc + 0.08, 0.0)], 0.036),
            ([(0.37, yc + 0.18, 0.0), (0.33, yc + 0.34, -0.12), (0.12, yc + 0.28, -0.14), (0.0, yc + 0.06, 0.0)], 0.032),
            ([(0.0, yc + 0.05, 0.34), (0.06, yc + 0.28, 0.30), (0.20, yc + 0.30, 0.10), (0.30, yc - 0.05, 0.05)], 0.028),
            ([(0.0, yc - 0.45, -0.34), (-0.14, yc - 0.50, -0.30), (-0.30, yc - 0.40, -0.14), (-0.36, yc - 0.42, -0.05)], 0.026),
            ([(0.37, yc - 0.60, 0.14), (0.30, yc - 0.85, 0.24), (0.14, yc - 1.05, 0.22), (0.10, yc - 1.30, 0.20)], 0.034),
            ([(-0.36, yc - 0.42, 0.13), (-0.30, yc - 0.80, 0.26), (-0.14, yc - 1.02, 0.24)], 0.03),
        ]:
            g += tube(catmull(pts, 5), r, 10, "engine_steel")
    # mount: neck, flange
    ym = y_mount
    g += cylinder((0.0, yc + 0.1, 0.0), (0.0, ym - 0.06, 0.0), 0.26, 0.30, seg, "engine_dark")
    g += cylinder((0.0, ym - 0.06, 0.0), (0.0, ym - 0.02, 0.0), 0.46, 0.46, seg + 8, "engine_dark")
    g += disc(ym - 0.06, 0.46, seg + 8, "engine_dark", up=False)
    if gimbal:
        # two hydraulic actuators at 90 degrees, running from the engine flange up and out to the plate
        for ang in (0.0, 90.0):
            for s in (1.0,):
                a = math.radians(ang)
                p0 = (0.44 * math.cos(a), ym - 0.10, -0.44 * math.sin(a))
                p1 = (0.72 * math.cos(a), ym + 0.0, -0.72 * math.sin(a))
                g += cylinder(p0, p1, 0.05, 0.055, 10, "engine_dark")
                g += cylinder(p0, (p0[0] * 0.98, ym - 0.02, p0[2] * 0.98), 0.075, 0.075, 10, "engine_dark")
        # actuator rod ends
    else:
        # rigid thrust-structure cone
        g += cylinder((0.0, ym - 0.02, 0.0), (0.0, ym + 0.05, 0.0), 0.62, 0.62, seg + 8, "engine_dark")
    return g


def build_engine(kind="sl_gimbal", lod=0):
    """Return (Geo, info) for an engine. info = dict(exit_y, exit_r, mount_y)."""
    if kind == "rvac":
        y_e, r_e, y_t, r_t = -1.5, 1.2, 1.55, 0.13
        y_top, y_mount, expo = 2.75, 3.4, 0.46
        hoops = [(-1.45, 0.02, 0.03)] + [(-1.2 + 0.24 * i, 0.012, 0.028) for i in range(0, 8)] + [(0.5, 0.015, 0.03), (0.0, 0.012, 0.03)]
        n, ribs, cols = 34, 40, 160
    else:
        y_e, r_e, y_t, r_t = -0.6, 0.6, 0.85, 0.115
        y_top, y_mount, expo = 1.98, 3.2, 0.58
        hoops = [(-0.57, 0.014, 0.022), (-0.25, 0.008, 0.02), (0.15, 0.008, 0.02), (0.5, 0.01, 0.02)]
        n, ribs, cols = 26, 32, 128
    g = Geo()
    if lod == 0:
        g += bell_geo(y_e, r_e, y_t, r_t, expo, n, ribs, cols=cols, hoops=hoops)
    else:
        rows = bell_rows(y_e, r_e, y_t, r_t, expo, 8, (), wall=0.02)

        def pos(U, row):
            r, y, w = row
            a = TAU * U
            return np.stack([r * np.cos(a), np.full_like(U, y), -r * np.sin(a)], axis=1)
        g += surface(pos, rows, 20, mat="engine_bell", ref_row=0)
    g += chamber_geo(y_t, r_t, y_top, mat="engine_steel") if lod == 0 else revolve_profile(
        [(r_t, y_t), (0.24, y_t + 0.4), (0.24, y_top - 0.2), (0.02, y_top)], nu=12, mat="engine_steel")
    g += powerhead(y_top, y_mount, gimbal=(kind != "sl_fixed"), lod=lod)
    if lod == 1:
        g.mat_all("engine_bell")     # far LOD: one material = one draw call per engine
    return g, dict(exit_y=y_e, exit_r=r_e, mount_y=y_mount)
