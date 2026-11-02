#!/usr/bin/env bash
# Stage externally obtained relocatable Linux x86_64 runtime distributions.
# Does not alter installed Sora, user profiles, mLearn environments, or /usr/bin.
set -Eeuo pipefail
usage() {
  echo "Usage: $0 --python-dir DIR --mpv-dir DIR --ffmpeg-dir DIR [--repo DIR]" >&2
  echo "Provide unpacked, trusted Linux x86_64 runtime bundles. No host executables are copied implicitly." >&2
  exit 2
}
repo="${HOME}/Applications/mlearn-custom-source"
py_source=''; mpv_source=''; ff_source=''
while (($#)); do
  case "$1" in
    --python-dir) (($# >= 2)) || usage; py_source="$2"; shift 2;;
    --mpv-dir) (($# >= 2)) || usage; mpv_source="$2"; shift 2;;
    --ffmpeg-dir) (($# >= 2)) || usage; ff_source="$2"; shift 2;;
    --repo) (($# >= 2)) || usage; repo="$2"; shift 2;;
    *) usage;;
  esac
done
[[ -n "$py_source" && -n "$mpv_source" && -n "$ff_source" ]] || usage
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Linux x86_64 only' >&2; exit 1; }
repo="$(realpath "$repo")"
py_source="$(realpath "$py_source")"
mpv_source="$(realpath "$mpv_source")"
ff_source="$(realpath "$ff_source")"
[[ -f "$repo/src/root-of-app/pip_requirements.json" ]] || { echo 'Missing Sora requirements' >&2; exit 1; }
[[ -x "$py_source/bin/python3" || -x "$py_source/python/bin/python3" || -x "$py_source/python/install/bin/python3" || -x "$py_source/install/bin/python3" ]] || { echo 'Python source requires bin/python3 (or python/install/bin/python3)' >&2; exit 1; }
# Require supplied media bundles, not /usr/bin/mpv or /usr/bin/ffmpeg.
locate_binary() {
  local base="$1" name="$2"
  if [[ -x "$base/bin/$name" ]]; then echo "bin/$name";
  elif [[ -x "$base/$name" ]]; then echo "$name";
  else echo "Missing $name in $base" >&2; exit 1; fi
}
mpv_rel="$(locate_binary "$mpv_source" mpv)"
ff_rel="$(locate_binary "$ff_source" ffmpeg)"
# Build in a sibling temporary directory and activate only after all checks pass.
parent="$repo/build/standalone"
mkdir -p "$parent"
tmp="$(mktemp -d "$parent/.staging.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/env" "$tmp/bin/libexec"
case 1 in
  1) if [[ -x "$py_source/python/bin/python3" ]]; then py_source="$py_source/python";
     elif [[ -x "$py_source/python/install/bin/python3" ]]; then py_source="$py_source/python/install";
     elif [[ -x "$py_source/install/bin/python3" ]]; then py_source="$py_source/install"; fi;;
esac
cp -a "$py_source/." "$tmp/env/"
cp -a "$mpv_source" "$tmp/bin/libexec/mpv-bundle"
cp -a "$ff_source" "$tmp/bin/libexec/ffmpeg-bundle"
cat > "$tmp/bin/mpv" <<'WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
base="$(cd "$(dirname "$0")" && pwd)"
bundle="$base/libexec/mpv-bundle"
export LD_LIBRARY_PATH="$bundle/lib:$bundle/lib64:$bundle/usr/lib:$bundle/usr/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ -x "$bundle/bin/mpv" ]]; then exec "$bundle/bin/mpv" "$@"; fi
exec "$bundle/mpv" "$@"
WRAPPER
cat > "$tmp/bin/ffmpeg" <<'WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
base="$(cd "$(dirname "$0")" && pwd)"
bundle="$base/libexec/ffmpeg-bundle"
export LD_LIBRARY_PATH="$bundle/lib:$bundle/lib64:$bundle/usr/lib:$bundle/usr/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ -x "$bundle/bin/ffmpeg" ]]; then exec "$bundle/bin/ffmpeg" "$@"; fi
exec "$bundle/ffmpeg" "$@"
WRAPPER
chmod +x "$tmp/bin/mpv" "$tmp/bin/ffmpeg"
python="$tmp/env/bin/python3"
# A symlink to host Python is not a standalone runtime.
for candidate in "$tmp/env/bin/python" "$python"; do
  if [[ -L "$candidate" ]]; then
    dest="$(realpath "$candidate")"
    [[ "$dest" == "$tmp/env/"* ]] || { echo "Host Python link rejected: $candidate -> $dest" >&2; exit 1; }
  fi
done
"$python" -I -c 'import sys,ssl,sqlite3; print(sys.version); print(sys.executable)'
# Install only the core backend dependencies. GPU/voice/OCR model packs are not included.
req="$tmp/core-requirements.txt"
node - "$repo/src/root-of-app/pip_requirements.json" "$req" <<'NODE'
const fs = require('node:fs');
const [source,dest] = process.argv.slice(2);
const obj = JSON.parse(fs.readFileSync(source,'utf8'));
if (!Array.isArray(obj.core)) throw new Error('No core requirements list');
fs.writeFileSync(dest, obj.core.join('\n')+'\n');
NODE
"$python" -m pip --version >/dev/null || "$python" -m ensurepip --upgrade
"$python" -m pip install --disable-pip-version-check -r "$req"
"$python" -I -c 'import fastapi,uvicorn,pydantic,bs4,PIL,numpy,multipart,websockets; print("Sora backend imports OK")'
"$tmp/bin/mpv" --version >/dev/null
"$tmp/bin/ffmpeg" -version >/dev/null
# Relocation smoke test: Python cannot depend on its original build directory.
relocated="$(mktemp -d "$parent/.relocation.XXXXXXXX")"
trap 'rm -rf -- "$tmp" "$relocated"' EXIT
cp -a "$tmp/env" "$relocated/env"
(cd / && "$relocated/env/bin/python3" -I -c 'import fastapi,uvicorn,pydantic,bs4,PIL,numpy,multipart,websockets; print("Relocated imports OK")')
rm -rf -- "$relocated"
# Atomic activation: never erase an existing stage without an explicit decision.
for component in env bin; do
  [[ ! -e "$parent/$component" ]] || { echo "Already staged: $parent/$component. Move it aside yourself before re-running." >&2; exit 1; }
done
mv -- "$tmp/env" "$parent/env"
mv -- "$tmp/bin" "$parent/bin"
echo "Runtime staging completed at $parent"
echo "NEXT: npm run dist:linux:standalone"
echo "NOTE: Media transitive dependencies and an isolated offline AppImage test are still required."
