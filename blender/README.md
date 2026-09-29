# Blender builds (headless, reproducible)

Run a build script with `bash blender/run.sh blender/<script>.py`. The runner strips mise/pyenv Python out of PATH, otherwise Blender fails with "No module named 'math'".
`lib.py` comes from the science-visualiser skill. It was written for millimetres. Our project uses METRES, so set `lib.S = 1.0` at the top of every build script (or pass metres through your own helpers).
- lib.V(x, y, z) maps three.js (x, y, z) to Blender (x, -z, y), so glTF export (+Y up) lands back in the three.js frame.
- Blender 5.x: `Mesh.shade_smooth()` takes no arguments. Leave concave boolean caps as n-gons. Pass robust booleans where needed.

Frame conventions are in the header of src/contracts.ts.
- Vehicle: origin at the engine plane on the axis; the tiled belly faces -z.
- Pad: origin is the world origin.
