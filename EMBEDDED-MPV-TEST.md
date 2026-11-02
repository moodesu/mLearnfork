# Experimental embedded mpv update

For the existing mLearn Custom v2.9.11 source checkout, including the earlier
study-panel, ASS/GoldenDict and Continue fixes. This ZIP contains changed source
files, not a standalone application. No dependency reinstall is needed.

## Apply and launch

1. Close mLearn Custom and stop its `npm run dev` terminal with Ctrl+C. Keep the
   original mLearn closed too (the backend ports are still shared).
2. Back up the current source. If you have made your own code edits, merge them
   instead of overwriting them. This backup uses a unique folder each time:

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_backup_dir=$(mktemp -d ../mlearn-before-embedded-XXXXXX)
cp -a package.json src "$mlearn_backup_dir/"
```

3. Assuming you downloaded the ZIP into Downloads, apply it and launch:

```bash
unzip -o /home/moo/Downloads/mlearn-embedded-mpv-test.zip -d .
npm run typecheck
npm run dev:embedded
```

`dev:embedded` sets an environment variable only for this launch and passes
`--ozone-platform=x11` on Electron's command line (setting it in the entry point
proved too late on the test machine). Only
mLearn uses XWayland; KDE stays on Wayland and retains your 120% scale. Your
existing mlearn-custom profile, cards and configured dictionaries are retained.

Requires the installed `mpv`, `python3`, and `libX11.so.6`, plus the normal
XWayland DISPLAY. The small window host uses Python's standard library only:
no pip packages, new language models or compiler are required. It uses the
normal desktop display connection; no X access-control changes are necessary.

## First desktop check

1. Maximise the mLearn window. Open an episode via Continue. Keep the player
   selection on `mpv (Linux prototype)`.
2. `Embedded video (experimental)` should be checked. Video should occupy an
   area inside mLearn, not open another mpv window. Press Play in mLearn.
3. Check picture and audio, then resize the application. On a wide window the
   study controls and transcript are beside the video. The Video width slider
   changes their proportions. A narrow window stacks the panels vertically.
   Close the Unknown Words sidebar if you want more space.
4. Confirm the external ASS and Japanese transcript resume through Continue.
   Select a transcript line, click a word for GoldenDict, and make a screenshot
   card. Captions drawn directly on the video are still not clickable: use the
   Current sentence panel for word lookups, as in the working prototype.
5. Try Fullscreen app, resize, Return Home, and Continue again. Confirm no
   orphan player remains after leaving the route or closing mLearn.

The video uses a real native X11 child, not a browser video element. It is hidden
when its area is offscreen/clipped or covered by recognised HTML dialogs,
drawers or word popups so it does not paint over them. Hiding the picture does
not itself pause playback. Native menus/dialogs and fractional-scaling behaviour
still need this live desktop check. Keep Developer Tools undocked during testing;
the initial geometry mapping assumes the main renderer fills the window's
content width. This is not yet a native-Wayland or cross-platform embedding path.

## Immediate fallback

Uncheck `Embedded video (experimental)` to reopen the same episode in the
separate mpv player at the current position. The checkbox applies to this player
view; entering the route again from the embedded launcher enables it again.

For the normal, separate-window launch, close the app and stop the development
terminal, then run:

```bash
cd /home/moo/Applications/mlearn-custom-source
npm run dev
```

No profile reset or desktop setting change is needed. If startup fails entirely,
restore package.json and src from the uniquely named backup above with the app
closed; do not delete or reset the profile.

If the embedded picture is blank, misplaced or opens separately, capture the
whole mLearn window and any red error text, plus the launch terminal's error.
Do not change KDE scaling or reinstall your dictionaries to troubleshoot it.

## Verification and design

Both TypeScript configurations, production build, and 413 targeted tests across
14 files passed. These cover host startup/cancellation/failure, private ownership,
argument validation, scale/menu-offset calculations, native viewport hiding,
switching back to a separate player, and existing mpv/subtitle/dictionary/capture
behaviour. The Python helper was syntax-checked and its Xlib bindings resolved
against the actual system library.

This workspace has no mpv or graphical X11 server: live native playback and
visual alignment have NOT been verified here. This is a test build for the
Manjaro desktop, not a claim that those checks have already succeeded.

The helper creates only its own child under the owning mLearn window. Native
handles stay in the main process; the renderer supplies only bounded geometry.
mpv receives the helper's child ID via --wid with the X11/EGL video output. It
starts windowed, uses the existing private mpv IPC pipe, and is closed with its
owner. No shell commands or arbitrary mpv flags are exposed through renderer IPC.

References: [mpv --wid](https://mpv.io/manual/stable/#options-wid),
[Electron platform notes](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices),
[Electron native window handles](https://www.electronjs.org/docs/latest/api/browser-window#wingetnativewindowhandle).

This is a personal modified build, not an official mLearn release. The upstream
LICENSE and MODIFICATIONS.md are included and continue to apply.
