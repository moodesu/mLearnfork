# Embedded mpv child-window mapping fix

Small incremental update for the existing mLearn Custom source installation,
after the embedded interaction update. No dependencies or profile changes.

## Evidence and change

The supplied xwininfo output showed that the private video host was IsViewable
but its mpv GL child was IsUnMapped. This patch explicitly maps the host's
direct children when the video area is visible. It also observes late-created,
reparented and unmapped children, instead of waiting for a viewport resize.
Window IDs are discovered at runtime, not copied from the diagnostic output.

Only the private host's children are affected, never the desktop or Electron's
other child windows. Dialog/viewport hiding is retained. Destroying a replaced
mpv child no longer terminates the host helper; destroying the owner still does.
Map/configure feedback is ignored. No polling or GPU-setting changes are added.

Xlib reference: [Mapping Windows](https://xorg.freedesktop.org/archive/current/doc/libX11/libX11/libX11.html).
XMapRaised maps the host; XMapSubwindows requests mapping of its children.

## Install

Stop the running development app with Ctrl+C. Download the ZIP to Downloads,
then run these commands in a terminal:

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_backup_dir=$(mktemp -d ../mlearn-before-window-map-fix-XXXXXX)
cp -a src/electron/services/mpvX11Host.ts "$mlearn_backup_dir/"
unzip -o /home/moo/Downloads/mlearn-embedded-window-map-fix.zip -d .
npm run dev:embedded
```

A full restart is necessary because this changes the Electron-side helper.
The source backup is in the newly created sibling mlearn-before-window-map-fix
directory. No npm install is needed. The ZIP includes the changed helper,
its tests, this note, the cumulative modification record, and the license.

## Desktop checks

1. Open the video with embedded mode enabled. The picture should appear without
   resizing the window; confirm audio and picture both follow a transcript seek.
2. Resize once, then open and close an overlapping dialog. The video should hide
   while covered and return afterwards.
3. Leave the video and reopen using Continue. Confirm picture, subtitles and
   transcript return.
4. If the picture remains black, collect fresh xwininfo output: window IDs change
   between sessions. The important field for mpv's GL child is now IsViewable.

Automated tests exercise the actual helper functions with simulated Xlib calls,
and bind the real Xlib symbols without a display. They do not verify visible
playback on KDE/XWayland. This patch addresses the observed unmapped-window
state; desktop stability still needs the checks above.
