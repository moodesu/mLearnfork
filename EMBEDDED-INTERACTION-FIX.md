# Embedded interaction update

For the existing mLearn Custom checkout with the embedded diagnostic update
already applied. Changed source files only; no profile reset or npm reinstall.

## Changes

- Embedded word definitions now appear directly below the sentence, inside the
  study column. The native video remains visible during normal word lookups.
  Footer buttons wrap to fit narrow panels. Reader/standalone popups are unchanged.
- Player requests use asynchronous JSON IPC. mpv documents that synchronous
  commands hold up IPC events until completion; async commands avoid blocking
  the connection. This addresses the code path consistent with the recording's
  screenshot timeout and frozen time/subtitle display, not a proven explanation
  of every possible playback failure.
- Current screenshots use the existing separate FFmpeg decoder at the live
  playback timestamp. No GPU-window screenshot command goes through mpv. Selected
  sentence screenshots retain their existing timestamp-based capture.

Reference: [mpv JSON IPC data flow and asynchronous commands](https://mpv.io/manual/stable/#asynchronous-commands).

## Install

Close mLearn Custom and stop its development terminal with Ctrl+C. Keep original
mLearn closed too. If you have made other source edits, merge instead of overwriting.

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_backup_dir=$(mktemp -d ../mlearn-before-interaction-fix-XXXXXX)
cp -a src "$mlearn_backup_dir/"
unzip -o /home/moo/Downloads/mlearn-embedded-interaction-fix.zip -d .
npm run dev:embedded
```

A complete restart is important: the previous process may still have an unfinished
blocking screenshot command. Existing profile, cards and dictionaries are untouched.

## Desktop checks

1. Play for at least 30 seconds. The clock, current sentence and transcript should
   continue advancing. Leave Follow playback checked when testing transcript scroll.
2. Hover several words. Definitions should appear in the study column, with no
   blanking of the picture. Move onto the definition to use its card controls.
3. Pause on a sentence and create a screenshot card. Then resume and confirm the
   clock and sentence continue updating. Also test selecting an older transcript row.
4. Resize the window and reopen through Continue to check subtitles and position.

Actual modal dialogs that cover the video still hide the native child deliberately;
this update does not make X11 video compositable beneath arbitrary HTML overlays.
Frame capture reads the source's first video stream and does not include player
filters or subtitle overlays. FFmpeg must remain available on PATH.

Automated checks do not validate the native XWayland compositor. If there is still
a freeze, send a recording plus the existing EmbeddedVideo diagnostic log lines.
The separate-player checkbox remains the immediate fallback.
