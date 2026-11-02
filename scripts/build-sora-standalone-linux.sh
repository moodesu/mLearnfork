#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
ENV_ROOT="$ROOT/build/standalone/env"
BIN_ROOT="$ROOT/build/standalone/bin"
PY="$ENV_ROOT/bin/python3"
MPV="$BIN_ROOT/mpv"
FFMPEG="$BIN_ROOT/ffmpeg"

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail "Linux x86_64 required"
[[ -x "$PY" ]] || fail "Missing executable: $PY"
[[ -x "$MPV" ]] || fail "Missing executable: $MPV"
[[ -x "$FFMPEG" ]] || fail "Missing executable: $FFMPEG"
[[ -f "$ROOT/src/root-of-app/server.py" ]] || fail "Missing backend entrypoint"
[[ -d "$ROOT/node_modules" ]] || fail "Run npm ci before packaging"
[[ -d "$ROOT/extension" ]] || fail "Missing extension source"

# Run from another cwd to catch accidental reliance on the source tree.
(cd / && "$PY" -I -c 'import fastapi, uvicorn, pydantic, bs4, PIL, numpy, multipart, websockets; print("Bundled Python imports OK")') || fail "Python runtime is not relocatable/complete"
# A copied venv typically contains symlinks to /usr/bin/python and MUST NOT be used.
for file in "$ENV_ROOT/bin/python3" "$ENV_ROOT/bin/python"; do
  if [[ -L "$file" ]]; then
    target=$(readlink -f "$file")
    [[ "$target" == "$ENV_ROOT/"* ]] || fail "$file resolves outside staged env: $target"
  fi
done

# The bundled mpv should run without depending on /usr/bin/mpv.
(cd / && "$MPV" --version >/dev/null && "$FFMPEG" -version >/dev/null) || fail "Bundled mpv/ffmpeg cannot start"
if command -v ldd >/dev/null; then
  while IFS= read -r exe; do
    if ldd "$exe" 2>&1 | grep -q 'not found'; then
      ldd "$exe" >&2
      fail "Missing shared-library dependency for $exe"
    fi
  done < <(find "$BIN_ROOT" -type f -perm /111 -print)
fi

# Keep the old release directory and working Sora AppImage intact.
OUT="$ROOT/release-standalone-test"
mkdir -p "$OUT"
echo "Building Sora standalone candidate (not replacing installed AppImage)..."
npm run build:extension
npm run build
npx electron-builder --linux AppImage --x64 --publish never --config.directories.output="$OUT"
shopt -s nullglob
files=("$OUT"/*.AppImage)
((${#files[@]})) || fail "No AppImage produced"
for f in "${files[@]}"; do
  echo "Candidate: $f"
  sha256sum "$f"
done
echo "Candidate build complete. Run isolated/offline functional validation before treating it as standalone."
