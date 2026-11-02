# Embedded player scrolling fix

Install over the player layout update. Runtime change: MpvPlayer.css only.

The recording shows the picture disappearing when the whole page scrolls up,
then returning when scrolled back down. At 65% video width with playback options
expanded, the left column is taller than the available viewport. Its sticky
position is constrained by its parent and the native surface becomes clipped
under the route header. The existing visibility guard then hides the video.

This update bounds the desktop layout to the player area's height. The study
column and tall playback controls scroll independently. The video surface can
shrink vertically to fit; mpv retains its aspect-ratio handling. No visibility
checks are disabled and no Electron, mpv, subtitle or capture logic changes.

Narrow stacked mode still scrolls normally, with the existing protection hiding
video when it genuinely leaves the visible area.

## Install

Download the ZIP to Downloads. Stop the development app with Ctrl+C, then:

```bash
cd /home/moo/Applications/mlearn-custom-source
mlearn_scroll_backup=$(mktemp -d ../mlearn-before-scroll-fix-XXXXXX)
cp -a src/renderer/components/video/MpvPlayer.css "$mlearn_scroll_backup/"
unzip -o /home/moo/Downloads/mlearn-player-scroll-fix.zip -d .
npm run dev:embedded
```

No dependency install is needed. The backup holds the previous stylesheet;
copy it back to the same source directory to undo the layout change.

## Check

- Use the same maximized window and 65% video width shown in the recording.
- Expand Tracks, timing and playback options.
- Scroll the study area, transcript and controls. On the two-column layout the
  video should remain in place instead of disappearing behind the header.
- Open and close a dialog; its existing hide/show behaviour should remain.

The CSS structure, UI controls and viewport/host guards have automated tests.
The CSS tests check layout declarations, not physical browser layout. Actual
KDE/XWayland scrolling still needs confirmation on your machine.
