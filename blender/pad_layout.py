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
APRON = dict(minX=-90.0, maxX=90.0, minZ=-70.0, maxZ=70.0)
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
