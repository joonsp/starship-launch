#!/usr/bin/env bash
# Run a Blender script headless. Strips version-manager Python installs from PATH,
# which otherwise shadow Blender's bundled/system Python stdlib.
set -euo pipefail
cd "$(dirname "$0")/.."
PATH=$(echo "$PATH" | tr ':' '\n' | grep -v -E 'mise/installs/python|pyenv|\.venv' | paste -sd:)
export PATH
unset PYTHONHOME PYTHONPATH
exec blender -b --factory-startup -P "$@"
