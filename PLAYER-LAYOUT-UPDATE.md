# Player layout update

Incremental UI-only update for the confirmed working embedded mpv build.
Install after the embedded child-window mapping fix.

## Changes

- Video and playback controls share the left column. Controls sit below the
  picture rather than consuming space above the current sentence.
- The current sentence, GoldenDict lookup and transcript share the right column.
- Video starts at 58% of the available layout width. The existing width slider
  now displays its percentage; resizing does not recreate the playback session.
- Playback position is a compact slider with an accessible name and time value.
  Tracks, timing, speed and volume remain in the collapsed options section.
- Transcript rows have more space and a clear current-line marker. The list uses
  more of the available screen height and continues to scroll independently.
- On narrow player areas (including space consumed by the word sidebar), the
  columns stack and the width control hides automatically.
- Study-panel subtitles use clean text without video-style glow/background/stroke.
  Word colours, readings, prosody, blur settings and lookup behaviour are retained.
  This does not change mpv's own subtitles, manga, flashcards or global settings.

No Electron/mpv helper, subtitle-restoration, dictionary-launcher or image-capture
code is included in this update. Playback actions and the native video surface
retain their existing lifecycle. The stable window-mapping fix stays installed.

## Install and preserve the working layout

Download the ZIP to Downloads. Stop the running development app with Ctrl+C.

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_layout_backup=$(mktemp -d ../mlearn-before-layout-XXXXXX)
cp -a src/renderer/components/video/MpvPlayer.tsx src/renderer/components/video/MpvPlayer.css src/renderer/components/video/MpvPlayer.test.tsx "$mlearn_layout_backup/"
unzip -o /home/moo/Downloads/mlearn-player-layout-update.zip -d .
npm run dev:embedded
```

No npm install is needed. The backup contains the three UI files being replaced.
To restore them, stop the app and use the actual backup directory printed by
`echo "$mlearn_layout_backup"` in the same terminal. Copy its three MpvPlayer files
back into `src/renderer/components/video/`, then restart `npm run dev:embedded`.
This restores the former layout without changing the working embedding fix.

## Check on your desktop

1. Open a video: controls should be below it, with sentence and transcript beside it.
2. Adjust Video width: the picture should resize without restarting playback.
3. Open the word sidebar and narrow the app: the layout should stack when needed.
4. Click a transcript line, hover a word, and create one flashcard. Confirm the
   same sentence and image are still captured.
5. Check both dark and light themes if you use them. Send a screenshot if the
   split or text size needs adjustment on your display scaling.

Automated checks cover the new DOM grouping, default/adjustable width without
reopening mpv, existing controls, transcript/lookup, contained hover, viewport
hiding, native-host mapping and FFmpeg image capture. Real KDE/XWayland visual
layout and playback require the desktop checks above; this environment has no
display server or browser for a visual screenshot test.
