# External ASS and GoldenDict-ng fix

Apply after mlearn-study-panel-update.zip, to the existing custom source checkout.
This is a small changed-files update, not a replacement installation.

Close mLearn Custom and stop npm run dev with Ctrl+C. Keep original mLearn closed.
If you have edited these source files yourself, merge them instead of overwriting.

```bash
cd /home/moo/Applications/mlearn-custom-source
unzip -o /home/moo/Downloads/mlearn-ass-goldendict-fix.zip -d .
npm run typecheck
npm run dev
```

No installation, dictionary migration, profile reset or new npm dependency is needed.

## Test

1. Open the video, then use mLearn's Open Subtitles button to select the external
   ASS file again. Its validated path is now retained for that track, even when
   mpv's metadata gives a relative name, file URL or opaque identifier.
2. Confirm the subtitle transcript fills. Select a row and check pause/seek.
3. Leave GoldenDict automatic clipboard/selection scanning off. Click a word in
   mLearn's study sentence. It should look up only that word in the main window.

The dictionary launcher first checks native commands, then the installed Flatpak
io.github.xiaoyifang.goldendict_ng. It uses --main-window, not --popup. The word is
a separate process argument; neither a shell command nor the clipboard is used.
Your configured dictionaries and main-window group remain in GoldenDict.

Unknown non-local subtitle sources are rejected unless their track was explicitly
associated with a validated local file opened through mLearn. No remote media
access or broader filesystem permissions are enabled.

## Verification

Both TypeScript configurations passed. 25 targeted tests across seven files passed,
including native FFmpeg conversion of an external ASS file with a Japanese filename,
local file URL handling, per-track path retention, overlapping subtitle-load and
transcript requests, and the Flatpak main-window invocation arguments.
The exact user's mpv metadata and desktop integration still require the test above.
