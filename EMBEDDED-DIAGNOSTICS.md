# Embedded video diagnostic update

Apply to the existing custom source after the embedded-player update. This does
not claim to fix the black picture. It adds bounded, event-driven logging to
separate renderer visibility guards, native window geometry and mpv output state.
The normal standalone player remains available.

Close the app and stop the development terminal with Ctrl+C. Keep original
mLearn closed. If you made your own source edits, merge instead of overwriting.

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_backup_dir=$(mktemp -d ../mlearn-before-diagnostics-XXXXXX)
cp -a package.json src "$mlearn_backup_dir/"
unzip -o /home/moo/Downloads/mlearn-embedded-diagnostics.zip -d .
npm run dev:embedded
```

This script now uses the explicit X11 launch that successfully opened the app,
without disabling GPU acceleration. No dependency reinstall or profile reset.

Open a video, leave experimental embedding checked, play for five seconds and
move the Video width slider once. Then, in another terminal:

```bash
grep 'EmbeddedVideo' /home/moo/.config/mlearn-custom/logs/electron.log /home/moo/.config/mlearn-custom/logs/renderer.log | tail -60
```

Send that output. `renderer` reports why the native child should be visible or
hidden; `host` reports parent/child IDs and requested pixel bounds; `mpv` reports
video-output properties and any stderr. `map-requested` means X11 was asked to
show the child, not proof that the compositor displayed it. Unsupported diagnostic
properties are nonfatal. Logs are capped per session/observer and do not include
subtitle text. mpv's own error messages can contain media paths; redact if needed.

Uncheck experimental embedding to return to the working standalone player.
