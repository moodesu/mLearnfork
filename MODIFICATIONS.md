# Personal mLearn Custom build

This is a modified version of Adrian Vlasov's mLearn, based on tag v2.9.11,
commit b60331c3f207d0c58d3a46b39f92ae697ac00185. It is not an official release.
The upstream copyright and Sustainable Use License in LICENSE remain applicable.

Modifications prepared for moo, September 2026:

- Opt-in Linux mpv playback through a private inherited IPC pipe, using the
  separately installed mpv executable. No Memento or mpv source code is bundled.
- Native audio/subtitle track selection, seek, pause, volume, speed, subtitle
  delay, full-screen toggle, active text subtitles and screenshot card capture.
- Separate application identity and user profile; upstream automatic updates
  and registration of the original application's URL scheme are disabled.
- Refuse occupied backend ports in the custom build rather than terminating
  unrelated processes. The standard build's existing behavior is retained.
- Pin json-canonicalize to 2.0.0 to avoid the incomplete 2.0.1 package encountered
  during the baseline build.

See MPV-PROTOTYPE.md for scope, setup, limitations and verification.

Study panel update, 2 September 2026:

- Compact playback controls and a scrollable text-subtitle transcript with
  follow-playback highlighting, delay-aware selection and click-to-seek.
- Word clicks and an editable lookup field open GoldenDict-ng's main window,
  using its existing configured dictionaries. No GoldenDict source is bundled.
- Native FFmpeg extracts the selected text track and sentence-time screenshots;
  media paths remain owned by the desktop session and subprocesses use no shell.
- Native manual cards preserve their source sentence/timestamps rather than
  copying the currently displayed subtitle. Capture failures are surfaced.
- First-run migration window closure no longer triggers application shutdown.

External ASS / GoldenDict follow-up:

- Remember validated external subtitle paths by track ID, waiting for sub-add
  registration before transcript extraction. Normalize local file URLs and relative
  filenames from mpv metadata without weakening renderer path validation.
- Support the configured GoldenDict-ng Flatpak and use --main-window, confirmed
  working with the user's installed 24.11.05 version. No clipboard mutation.

Continue subtitle startup fix:

- Wait for mpv's file-loaded event, not merely its loadfile command acknowledgement,
  before marking the player ready and restoring the saved external subtitle.
- Reject pending startup on load failure, close, process exit, or a bounded timeout.
  No fixed delay or polling is used to guess when subtitle commands are safe.

Experimental embedded player, 2 September 2026:

- App-only XWayland launch via npm run dev:embedded; no desktop/session changes.
- A private Python standard-library/Xlib helper creates an actual child window
  for mpv --wid within the owning Electron window. No mpv/Xlib source is bundled.
- Event-driven geometry updates account for CSS zoom/display scaling, hide the
  child for HTML overlays, and dispose it with its owning playback session.
- Responsive video/study columns, adjustable video width and a separate-window
  fallback checkbox. Fullscreen acts on the whole app in embedded mode.
- Existing external ASS, transcript, dictionary and screenshot workflows remain.

See EMBEDDED-MPV-TEST.md for installation, desktop checks and limitations.

Embedded diagnostics, 2 September 2026:

- Pass the X11 Ozone switch on Electron's command line, rather than selecting it
  late in customMain. This matches the launch the user confirmed opens correctly.
- Add bounded visibility-reason, X11 geometry and mpv video-output logging tagged
  EmbeddedVideo. Normal standalone operation does not request these properties.
- This is instrumentation for the unresolved black-picture issue, not a verified
  rendering fix. See EMBEDDED-DIAGNOSTICS.md for the desktop test.

Embedded interaction update, 2 September 2026:

- Keep word definitions in the embedded player's study column, with wrapping
  controls, instead of allowing hover popups to overlap and hide native video.
  Reader and standalone-player hover positioning remains unchanged.
- Send JSON IPC commands with async:true and correlate replies by request ID.
  A waiting command must not withhold time/subtitle events on the connection.
- Capture the current frame through the existing bounded FFmpeg utility using
  mpv's live time-pos. No screenshot-to-file request is sent to the live player;
  capture is independent of X11 visibility and cancelled with the owner session.
- Retain the explicit X11 launcher, existing diagnostic logs, subtitle restoration,
  GoldenDict integration and screenshot-only card workflow.

See EMBEDDED-INTERACTION-FIX.md for installation and the remaining desktop checks.

Embedded child-window mapping update, 2 September 2026:

- User diagnostics show the host IsViewable but mpv's GL child IsUnMapped.
- Map direct children of the private video host when the viewport is visible
  and within its parent. Mapping the host alone is insufficient in this state.
- Observe child creation, reparenting and unmapping so late/recreated mpv windows
  are shown without requiring a renderer resize. Ignore mapping/configuration
  feedback and do not exit when mpv replaces its child window.
- Preserve hidden/clipped viewport handling and all existing playback settings.
- Headless regression tests cover mapping, recreation, dialog hiding, clipping,
  feedback suppression and owner destruction. Desktop rendering remains to be
  confirmed on the user's machine.

See EMBEDDED-WINDOW-MAP-FIX.md for installation and desktop checks.

Player layout update, 2 September 2026:

- User confirmed the mapping fix stable for resize, dialogs, Continue and
  flashcard sentence/image capture. Preserve that playback implementation.
- Move playback controls beneath the native video, leaving the right column
  for the current sentence, dictionary lookup and a larger transcript list.
- Compact controls, display the adjustable video-width percentage, start at 58%,
  and stack columns based on the available player width.
- Remove cinematic text glow/background/stroke only in the mpv study panel;
  retain word colours, reading annotations and existing lookup/settings behaviour.
- Add regression coverage for UI grouping, controls and resizing without a new
  playback session. No changes to Electron embedding or capture services.

See PLAYER-LAYOUT-UPDATE.md for installation, backup and desktop checks.

Player scroll containment update, 2 September 2026:

- The user recording showed the native video becoming hidden as whole-page
  scrolling clipped the tall video/controls column behind the route header.
- Bound the desktop layout to the available height. Scroll the study column
  and expanded controls independently, instead of using a tall sticky column.
- Preserve stacked narrow-window scrolling, aspect-ratio handling, native
  viewport protection, playback and screenshot/flashcard logic.
- Add CSS contract regression checks for bounded rows and scroll containment.

See PLAYER-SCROLL-FIX.md for installation and desktop checks.

Packaged baseline installer, 2 September 2026:

- Build the confirmed custom source as one Linux x64 AppImage and install it at
  a stable per-user path, with a KDE application launcher that enables the proven
  embedded mpv/X11 configuration.
- Preserve the current git-backed source as a timestamped bundle, tracked patch,
  untracked archive and manifest without changing its branch, index or history.
- Reuse the isolated mlearn-custom profile and stable launcher path so settings,
  cards and taskbar pinning survive later rebuilds.
- Check the source, embedded-player regression set and shell installer before
  packaging. Do not alter the working playback implementation.

See PACKAGED-BASELINE.md for installation, baseline contents and first-run checks.
