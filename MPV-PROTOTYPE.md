# mLearn Custom: mpv prototype

## What this version does

This is a Linux desktop source prototype, not an AppImage or a finished embedded
player. It replaces browser playback when **Player → mpv (Linux prototype)** is
selected in the Video screen. mpv opens its own video window; mLearn retains
playback controls, clickable text subtitles, the unknown-word sidebar and SRS.
The existing browser player remains available.

Supported: local media files, track IDs from mpv, external subtitle files,
positive/negative subtitle delay, pause/seek/volume/speed/fullscreen, playback
position resume, subtitle transcript navigation, GoldenDict-ng lookup and
sentence-timestamp screenshot capture for vocabulary cards.
Playback initially pauses so you can select tracks before watching.

The private pipe is created per playback process; no public IPC socket or shell
command is exposed. mpv launches without your standalone configuration or scripts.
Closing the route or application closes its own mpv process, not other players.

## Install this source snapshot on Manjaro

Prerequisites: Git, a supported Node.js/npm installation, and `mpv` and `ffmpeg` on PATH.
GoldenDict lookup additionally requires a configured GoldenDict-ng installation
available as `goldendict` or `goldendict-ng` on PATH, or the installed Flatpak
`io.github.xiaoyifang.goldendict_ng`. Its existing dictionary folders and main-window
group are used; no dictionaries are imported here.
The development checks used Node 24.19.0. Your existing standalone mpv installation
is sufficient; Memento is not used. No codec or model downloads are added by this
feature. Existing prototype users should follow STUDY-PANEL-UPDATE.md instead.

This ZIP contains changed source files, not the complete application. Download it
to `/home/moo/Downloads/mlearn-mpv-prototype.zip`, then clone the matching upstream
release into a new source directory and apply the ZIP there. Do not apply it to
the extracted AppImage or a checkout containing other edits:

```bash
git clone --branch v2.9.11 --single-branch https://github.com/adrianvla/mLearn.git /home/moo/Applications/mlearn-custom-source
cd /home/moo/Applications/mlearn-custom-source
git switch -c moo-mpv-prototype
unzip /home/moo/Downloads/mlearn-mpv-prototype.zip -d /home/moo/Applications/mlearn-custom-source
unzip -o /home/moo/Downloads/mlearn-study-panel-update.zip -d /home/moo/Applications/mlearn-custom-source
npm install
npm run typecheck
npm run dev
```

Git clone refuses to overwrite a nonempty target directory. Do not replace your
existing mLearn installation or copy these files into its extracted AppImage.

This creates **mLearn Custom** with its own profile, normally
`/home/moo/.config/mlearn-custom`. Your normal `/home/moo/.config/mlearn` profile is
not copied or migrated automatically. Expect first-run setup and language data
installation for the new profile. Keep the original app closed during testing:
the upstream backend still uses ports 7752 and 7753, and this build refuses to
start if those ports are occupied. Do not start the original app while testing.

Use `npm run dev` for this source checkout. A standalone `npx electron .` does
not start the renderer development server. No AppImage has been packaged.
Do not use the original app's updater for this build. Its update actions are
disabled; a manual update check can show an unavailable/error status.

## First test

1. In the custom profile, select your learning language. Keep the trial's normal
   screenshot-based card workflow and disable automatic TTS if you do not want it.
2. Open Video and choose **Player → mpv (Linux prototype)** before opening a file.
3. Open the local Shirokuma Cafe episode. A separate mpv window should appear,
   paused. Missing mpv or launch failures should appear in the mLearn panel.
4. Select the intended audio and subtitle tracks in mLearn. Confirm real audio
   changes in the player. Use Open Subtitles for an external ASS/SRT/VTT file.
5. Press Play; pause and seek from each window. Confirm that text in mLearn follows
   mpv, including a positive subtitle delay (positive means display later).
6. Select an earlier transcript line. It pauses/seeks the video and opens that
   sentence in the study panel. Click a word for GoldenDict-ng; hover for the
   existing mLearn dictionary and card controls. Cards use that sentence's
   midpoint frame rather than whatever is playing later. Audio on the card is
   not part of this prototype. Translation still uses your configured provider.
7. Return home. Confirm the mpv window closes. Reopen the episode and check saved
   playback position. Switch to Browser to verify the original player still works.

For Flying Witch's already-retimed subtitle file, leave the delay at zero.

## Deliberate limits

- Video is not embedded in the Electron window yet. Native embedding on Wayland
  needs its own design and real-desktop tests after this connection is validated.
- The transcript supports text tracks through native FFmpeg. Select a row to
  study its words in the panel above it; rows are not all tokenized in advance.
  mLearn's old subtitle-sync dialog is not part of this mode.
- Image-based subtitles (PGS/VobSub) display in mpv but do not produce clickable
  text. Supply a text subtitle file if needed.
- Track selection, speed and subtitle delay reset when reopening. External
  subtitle paths chosen through mLearn retain its existing recent-item behavior.
- Manual cards use their saved sentence and a frame at its midpoint, via native
  FFmpeg. Capture failure is reported rather than substituting a different frame.
  Lightweight automatic suggestions still use the current-frame capture path.
- Screenshot-only cards in native mode; no extracted audio/video clips. Existing
  independent TTS settings are unchanged. GoldenDict opens its main window; its
  definitions are not automatically copied into mLearn cards.
- No Watch Together, remote URL playback, overlay-window control, or automatic
  recent-item video thumbnails in native mode. Remote URLs use the browser path.
- Linux-only transport. macOS and Windows keep the browser player.
- The original application's deep-link association is not replaced. Cloud sign-in
  callbacks and external dictionary deep links are not wired to the custom scheme
  in this prototype; use local learning features for the smoke test.
- This snapshot is based on upstream v2.9.11, commit
  `b60331c3f207d0c58d3a46b39f92ae697ac00185`. GitHub publishing was blocked by
  integration permissions; no prototype branch or commit has been pushed to
  https://github.com/moodesu/mLearnfork. Its `main` branch is unchanged.

## Verification

Automated checks cover command validation, process failure/timeout/cleanup,
Unicode IPC chunks, path validation, subtitle tokenization, native screenshot
routing, track controls, position resume and profile-port isolation. Existing
bridge, subtitle and flashcard helper tests are included in the targeted run.

See STUDY-PANEL-UPDATE.md for the current update's verification and smoke test.

The previous full-suite run was interrupted by a workspace disconnection, so it
has no final result. The upstream baseline already had unrelated failing tests;
the full suite is not being reported as green.

The initial player was confirmed working by moo on Manjaro. The new desktop
lookup and transcript interactions still need the update's smoke test there.
