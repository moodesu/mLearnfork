# Continue: restore external subtitles after the video is ready

Apply to the existing custom source checkout after the study-panel and
ASS/GoldenDict updates. Only the mpv client, its tests and documentation change.
No profiles, saved subtitle paths, cards or dictionaries are reset.

## Apply

Close mLearn Custom and stop its npm run dev terminal with Ctrl+C.
Keep the original mLearn closed. If you have edited the supplied source files,
merge your edits instead of overwriting them.

```bash
cd /home/moo/Applications/mlearn-custom-source
unzip -o /home/moo/Downloads/mlearn-continue-subtitle-fix.zip -d .
npm run typecheck
npm run dev
```

## Test the actual failing workflow

1. Open the episode directly from Continue, without manually adding the ASS.
2. Confirm the Japanese subtitle track and Japanese transcript return without
   the mpv:subtitle command error. Check the saved video position also resumes.
3. Return Home and use Continue again. Repeat once after restarting the app.

If the subtitle path was never saved, choose the ASS once through Open Subtitles,
return Home, then repeat Continue. If an error still occurs, capture the message
and expanded subtitle-track selector before changing tracks.

## Cause and fix

The previous client marked the video ready as soon as loadfile returned success.
mpv documents that this only schedules loading; the video may not have begun
opening yet. This allowed the saved ASS sub-add request to arrive too early.

The client now waits for both command success and file-loaded. The existing
saved-subtitle restoration then runs after the video has loaded. Errors, closing
the player and stalled loading settle the pending startup safely.

Reference: [mpv loadfile and events](https://mpv.io/manual/stable/#command-interface).

## Verification

Both TypeScript configurations and 76 targeted tests across eight files passed.
Regression tests delay file-loaded after a successful loadfile acknowledgement
and verify that the saved ASS is not added prematurely. Failure, close, exit,
timeout and reopening cases are covered. Native FFmpeg tests also passed.
Live mpv/Wayland playback is not available in this workspace, so the Continue
workflow above still needs the desktop check.
