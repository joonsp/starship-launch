"""Shared layout numbers for the Pad 2 build (three.js frame, metres). Every builder and the collider export
read from here so the model, the colliders and the sandbox checks agree.

Sources: specs/starship.json (pad.*, scene.*), public/data/site.json (OSM), research/pad.md. Estimates are
flagged (est) in the spec; the tower footprint is the OSM polygon of way 1207227015 (an 11.6 m square rotated
32.3 deg about y: its axis-aligned bounding box is the 16 x 16 m in the spec).
"""
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

with open(os.path.join(ROOT, "specs", "starship.json"), encoding="utf-8") as f:
    SPEC = {k: v["v"] for k, v in json.load(f)["values"].items()}
with open(os.path.join(ROOT, "public", "data", "site.json"), encoding="utf-8") as f:
    SITE = json.load(f)


def val(k):
    return SPEC[k]


# ---------------------------------------------------------------- tower 2
TOWER_C = np.array([val("pad.tower2_centre")[0], 0.0, val("pad.tower2_centre")[2]])
TOWER_H = val("pad.tower2_height")             # 144.5 incl. lightning masts
TOWER_YAW = -32.3                              # three.js rotation.y (deg); local +x -> world (0.845, 0, 0.534)
TOWER_HW = 5.45                                # chord centre offset from the axis
CHORD = 1.1                                    # chord box size
BAY = 6.0
N_BAYS = 22                                    # lattice body 0..132 m
HOUSE_Y0, HOUSE_Y1 = 132.0, 141.0              # cladded top house
MAST_TOP = TOWER_H                             # lightning masts end at 144.5
CARRIAGE_Y = 125.3                             # chopstick carriage mid height: photo crossbar row 489-494 (spec est 124 +-6)
BOOM_Y = 74.5                                  # west QD / service pod centre height: measured 69-78 m in the photo (spec est 65)

# ---------------------------------------------------------------- chopsticks (world frame)
ARM_PIVOT_X = 7.4                              # hinge x (each side of the vehicle axis)
ARM_PIVOT_Z = -10.2                            # hinge z (on the carriage crossbar)
ARM_LEN = 18.4                                 # hinge to tip (OSM 16 m + hinge; spec est 17)
ARM_OPEN_DEG = 53.0                            # swing from +z toward outboard: tips ~ +-24 m => ~44+ m tip to tip
ARM_W, ARM_H = 3.4, 4.6                        # arm truss section

# ---------------------------------------------------------------- orbital launch mount (Pad 2)
OLM_TOP = val("scene.olm_deck_height")         # 20
OLM_HALF = 17.0                                # 34 m square (est)
OLM_THICK = 2.6                                # deck box-girder depth
HOLE_R = 5.0                                   # central booster opening, 10 m across
APRON_TOP = 0.12
APRON = dict(minX=-90.0, maxX=90.0, minZ=-70.0, maxZ=70.0)   # scene-config.ts APRON (contract rectangle); the slab itself is APRON_POLY
TRENCH_CUT = dict(halfX=40.0, halfZ=16.0)      # env terrain cutout (scene-config.ts TRENCH_CUTOUT)

# ---------------------------------------------------------------- flame trench (east-west)
TR_FLOOR = -8.0
TR_HX = 30.0                                   # full-depth floor half length (60 m)
TR_HZ = 12.5                                   # interior half width (25 m)
TR_WALL_OUT = 16.0                             # outer face of the wall collar (matches the terrain cutout)

# ---------------------------------------------------------------- pad 1
P1_C = np.array([val("pad.pad1_tower_centre")[0], 0.0, val("pad.pad1_tower_centre")[2]])
P1_H = val("pad.pad1_tower_height")
P1_YAW = -34.5
P1_AXIS = np.array([val("pad.pad1_axis")[0], 0.0, val("pad.pad1_axis")[2]])


def yaw_mat(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def tower_to_world(pts, centre=TOWER_C, yaw=TOWER_YAW):
    """Map tower-local points (n,3) to world."""
    return np.asarray(pts) @ yaw_mat(yaw).T + centre


# ---------------------------------------------------------------- pad-local frame (PAD_YAW)
# The mount, trench, diverter, apron, deluge plumbing and site pieces are authored in a PAD-LOCAL frame (x along the
# trench axis, z across it) and placed with rotation.y = PAD_YAW about the vehicle axis (scene-config.ts PAD_YAW,
# toPadLocal). In Blender that is add_object(..., yaw_deg=PAD_YAW), the same convention as the tower.
PAD_YAW = val("scene.trench_yaw")              # -33.1 deg: local +x -> world (0.838, 0, 0.546), bearing 123 deg


def pad_to_world(pts):
    """Pad-local (n,3) -> world (n,3)."""
    return np.asarray(pts, dtype=float) @ yaw_mat(PAD_YAW).T


def world_to_pad_xz(x, z):
    a = math.radians(PAD_YAW)
    c, s = math.cos(a), math.sin(a)
    return c * x - s * z, s * x + c * z


def pad_to_world_xz(x, z):
    a = math.radians(PAD_YAW)
    c, s = math.cos(a), math.sin(a)
    return c * x + s * z, -s * x + c * z


# Tower 2 and its annex (OSM polygons) in the pad-local frame. Nothing of the mount may intrude on this zone.
_tx, _tz = world_to_pad_xz(float(TOWER_C[0]), float(TOWER_C[2]))
TOWER_LOCAL_C = (_tx, _tz)                     # about (-17.3, -21.3)
# bounding rectangle of the four footings (leg centre +-5.45, footing 4.2 m) and of the annex L, plus a 1 m margin
TOWER_ZONE = dict(minX=-30.0, maxX=-8.7, minZ=-34.0, maxZ=-12.8)


def in_tower_zone(x, z, m=0.0):
    Z = TOWER_ZONE
    return Z["minX"] - m <= x <= Z["maxX"] + m and Z["minZ"] - m <= z <= Z["maxZ"] + m


# ---------------------------------------------------------------- apron slab (pad-local plan polygon)
# The photo's slab (x 820-1330, y 725-775) back-projects to pad-local z 160-215: a concrete plane runs from the mount
# out to a straight front edge along the trench axis at z = 213, with a chamfered west corner (the diagonal edge seen
# left of the slab in the photo, through local (20, 165) and (59, 213)).
APRON_POLY = [(-90.0, -70.0), (90.0, -70.0), (160.0, 0.0), (255.0, 70.0), (255.0, 200.0), (240.0, 213.0),
              (59.0, 213.0), (20.0, 165.0), (-52.0, 76.0), (-90.0, 76.0)]
