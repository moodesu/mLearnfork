#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Build and install the confirmed mLearn Custom Linux baseline.' \
    '' \
    'Usage: ./scripts/install-mlearn-custom-linux.sh' \
    '' \
    'Creates:' \
    '  ~/Applications/mLearn-Custom/mLearn-Custom.AppImage' \
    '  ~/.local/share/applications/local.moo.mlearncustom.desktop' \
    '  ~/Applications/mLearn-Custom/baselines/<timestamp>/'
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi
if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  printf '%s\n' 'This installer supports Linux x86_64 only.' >&2
  exit 1
fi
for command_name in git npm mpv python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd -- "$script_dir/.." && pwd)
if [[ ! -f "$source_root/package.json" || ! -d "$source_root/.git" ]]; then
  printf '%s\n' 'Run this installer from the mLearn Custom git checkout.' >&2
  exit 1
fi

install_dir="$HOME/Applications/mLearn-Custom"
baseline_root="$install_dir/baselines"
desktop_dir="$HOME/.local/share/applications"
icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"
desktop_file="$desktop_dir/local.moo.mlearncustom.desktop"
app_file="$install_dir/mLearn-Custom.AppImage"
timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/mlearn-custom-build-XXXXXX")
cleanup() { rm -rf -- "$build_dir"; }
trap cleanup EXIT

mkdir -p -- "$baseline_root" "$desktop_dir" "$icon_dir"
baseline_dir=$(mktemp -d "$baseline_root/${timestamp}-XXXXXX")
cd -- "$source_root"

# Preserve the exact custom source state without changing the user's index,
# branch or history. Tracked edits and untracked custom files are separate so
# either can be inspected/restored with ordinary git/tar tools.
git bundle create "$baseline_dir/repository.bundle" --all
git diff --binary HEAD > "$baseline_dir/tracked-changes.patch"
mapfile -d '' untracked_files < <(git ls-files --others --exclude-standard -z)
if [[ ${#untracked_files[@]} -gt 0 ]]; then
  printf '%s\0' "${untracked_files[@]}" |
    tar --null --no-recursion --files-from=- -czf "$baseline_dir/untracked-files.tar.gz"
else
  tar --files-from=/dev/null -czf "$baseline_dir/untracked-files.tar.gz"
fi
git status --short > "$baseline_dir/status.txt"
git rev-parse HEAD > "$baseline_dir/base-commit.txt"

printf '%s\n' 'Checking the confirmed source baseline...'
npm run typecheck
npm test -- \
  src/renderer/components/video/MpvPlayer.layout.test.ts \
  src/renderer/components/video/MpvPlayer.test.tsx \
  src/renderer/services/mpvViewport.test.ts \
  src/electron/services/mpvX11Host.test.ts \
  src/electron/services/mpvService.embedded.test.ts \
  src/electron/services/mpvClient.test.ts \
  src/electron/services/mpvStudyTools.integration.test.ts

printf '%s\n' 'Building the x64 AppImage...'
npm run build:extension
npm run build
./node_modules/.bin/electron-builder --linux AppImage --x64 --publish never \
  --config.directories.output="$build_dir"

mapfile -d '' app_images < <(find "$build_dir" -maxdepth 1 -type f -name '*.AppImage' -print0)
if [[ ${#app_images[@]} -ne 1 ]]; then
  printf 'Expected one AppImage, found %s in %s\n' "${#app_images[@]}" "$build_dir" >&2
  exit 1
fi

mkdir -p -- "$install_dir"
if [[ -f "$app_file" ]]; then
  cp -a -- "$app_file" "$baseline_dir/mLearn-Custom.previous.AppImage"
fi
install -m 0755 -- "${app_images[0]}" "$app_file"
install -m 0644 -- "$source_root/build/icons/256x256.png" "$icon_dir/local.moo.mlearncustom.png"

desktop_contents=$(printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Version=1.0' \
  'Name=mLearn Custom' \
  'Comment=Japanese immersion study with embedded mpv' \
  "Exec=env MLEARN_EMBEDDED_MPV=1 \"$app_file\" --ozone-platform=x11 %U" \
  'Icon=local.moo.mlearncustom' \
  'Terminal=false' \
  'Categories=Education;Languages;' \
  'StartupNotify=true' \
  'StartupWMClass=mLearn Custom' \
  'MimeType=video/x-matroska;video/mp4;')
printf '%s\n' "$desktop_contents" > "$desktop_file"
chmod 0644 "$desktop_file"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

printf '%s\n' \
  '' \
  'mLearn Custom is installed.' \
  "Application: $app_file" \
  "Launcher:    $desktop_file" \
  "Baseline:    $baseline_dir" \
  '' \
  'Open the KDE application launcher, search for mLearn Custom, and start it.' \
  'While it is running, right-click its taskbar icon and choose Pin to Task Manager.'
