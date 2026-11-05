#!/bin/bash
# Usage: launch.sh [--agents] [folder]. Set VSCODE_BIN to the code-insiders executable.
# PHASE0_DIR holds the throwaway profile and sample workspace.
set -euo pipefail
DIR="${PHASE0_DIR:-/tmp/phase0}"
BIN="${VSCODE_BIN:-code-insiders}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/profile/User" "$DIR/ws/src"
cat > "$DIR/profile/User/settings.json" <<JSON
{ "security.workspace.trust.enabled": false, "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.startupEditor": "none", "window.dialogStyle": "custom" }
JSON
printf 'export const a = 1;\nexport const b = 2;\n' > "$DIR/ws/src/sample.ts"
base64 -d > "$DIR/ws/shot.png" <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHwYYYBwAK0sP8XfOZVoAAAAASUVORK5CYII=
PNG
# Installed rather than loaded with --extensionDevelopmentPath, which would override --agents.
if [ ! -f "$DIR/spike.vsix" ]; then
  (cd "$HERE/extension" && npx --yes @vscode/vsce package --no-dependencies --skip-license --allow-missing-repository --out "$DIR/spike.vsix" >/dev/null)
fi
"$(dirname "$(readlink -f "$BIN")")/bin/$(basename "$BIN")" --no-sandbox --user-data-dir="$DIR/profile" --extensions-dir="$DIR/extensions" --install-extension "$DIR/spike.vsix" --force >/dev/null 2>&1
ARGS=()
if [ "${1:-}" = "--agents" ]; then ARGS+=(--agents --skip-sessions-welcome); shift; fi
exec xvfb-run -a -s "-screen 0 1500x950x24" "$BIN" --no-sandbox --disable-dev-shm-usage --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$DIR/profile" --extensions-dir="$DIR/extensions" --remote-debugging-port=9333 --skip-welcome "${ARGS[@]}" "${1:-$DIR/ws}"
