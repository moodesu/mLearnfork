# mLearn Custom — study panel update

This is an incremental source update for the previous mlearn-mpv-prototype.zip.
It is not an AppImage and not a complete repository. No mpv scripts or Memento
customisation are included. Your separate player window stays in use.

## Apply to the existing custom source checkout

1. Close mLearn Custom and stop its `npm run dev` terminal with Ctrl+C. Keep the
   original mLearn closed too. Leave GoldenDict-ng running with your dictionaries.
2. Save the new ZIP as `/home/moo/Downloads/mlearn-study-panel-update.zip`.
3. If you have manually edited this checkout since the first ZIP, stop and merge
   those changes first: the unzip command below replaces the supplied source files.
4. Otherwise run:

```bash
cd /home/moo/Applications/mlearn-custom-source
unzip -o /home/moo/Downloads/mlearn-study-panel-update.zip -d /home/moo/Applications/mlearn-custom-source
npm run typecheck
npm run dev
```

No new npm packages are required. This does not delete/copy your profile or reset
setup, dictionaries or cards. Do not apply it to the extracted original AppImage.
Use `npm run dev`, not a standalone `npx electron .`, for this source checkout.

Required native commands: `mpv`, `ffmpeg`, and `goldendict` (or `goldendict-ng`),
or `flatpak` with `io.github.xiaoyifang.goldendict_ng` installed.
The previously detected `/usr/bin/ffmpeg` is suitable for the native tool lookup.
The follow-up ASS-GOLDENDICT-FIX.md adds Flatpak support and main-window lookups.
Keep automatic clipboard/selection scanning off while testing direct lookups.

## What changed

- Track, delay, volume and speed controls are collapsed under playback options.
  The navigation wraps in a narrow window and the study sentence stays near the top.
- Selecting a text subtitle track loads its transcript using system FFmpeg.
  External ASS/SSA/SRT/VTT and embedded text subtitles are supported. Bitmap
  subtitles cannot become a clickable transcript without OCR.
- The current line is highlighted. Follow playback scrolls the list; scrolling
  with the wheel disables following so you can browse. Enable it again to resume.
- Click a transcript row to pause and seek. That sentence appears in the study
  panel, where its words are interactive. Play resumes live sentence following.
- Click a word for GoldenDict-ng. Playback pauses before lookup. The editable
  field can search another spelling or phrase. GoldenDict uses its configured
  folders/group and its main window; this does not replace the built-in definitions
  used for mLearn flashcards. Hover still opens mLearn's word/card controls.
- Manual native cards use the selected/recorded sentence, not the current DOM.
  Native FFmpeg captures its midpoint frame without seeking the live player.
  Source path, sentence times and screenshot time are saved in the card metadata.
  An unavailable frame causes an error; no unrelated screenshot is substituted.
- Changing subtitle tracks/delay clears accumulated sidebar words so old timing
  and words are not carried into the new track context.
- The hidden first-run migration window can close without quitting the app.

## Smoke test on Manjaro

1. Open an episode in mpv mode. Check playback/audio still work. The study panel
   should show a subtitle list after selecting a text track.
2. Select an earlier line. Confirm the video pauses/seeks to that sentence.
3. Click a word in the study panel. Confirm GoldenDict-ng opens your dictionaries.
4. Hover a word and add a card. Check its sentence and image. Also try an earlier
   accumulated sidebar word after playing ahead: it must retain its own sentence.
5. Change subtitle delay by a small amount, select a row, and confirm seek time
   follows the adjusted timing. Restore your correct delay afterwards.
6. Switch tracks or turn subtitles off. The previous transcript must not reappear.
7. Return home and reopen the episode. Confirm the mpv window closes/reopens and
   playback position still resumes.

## Remaining boundaries

Video subtitles inside mpv are still not clickable. There is no Memento-style
overlay, extracted card audio, embedded video window, automatic GoldenDict
definition import, or saved track/delay selection yet. Lightweight automatically
suggested cards retain the existing current-frame capture behaviour.

The workspace can run automated tests and native FFmpeg checks, but cannot verify
GoldenDict's real window or Wayland desktop placement. Those need the smoke test.

## Verification for this update

- Both TypeScript configurations passed `npm run typecheck`.
- 581 targeted tests passed across 20 files, covering player IPC, lifecycle,
  transcript timing, stale results, card context, captures and platform bridges.
- Native FFmpeg integration extracted external and embedded subtitle text and
  captured a JPEG at the requested timestamp.
- `npm run build` passed (with the existing large-bundle size warning).
- All six locale JSON files and `git diff --check` passed.

The complete repository test suite was not run. Real desktop window behaviour and
layout still require the Manjaro smoke test above.
