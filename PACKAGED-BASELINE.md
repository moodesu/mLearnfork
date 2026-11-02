# Packaged mLearn Custom baseline

This packages the desktop build confirmed working on Manjaro: embedded mpv,
track selection, external ASS restoration and transcript, GoldenDict-ng lookup,
independent scrolling, and screenshot flashcards with the correct sentence.

The installed app uses the existing `~/.config/mlearn-custom` profile. Settings,
language data, flashcards and progress are not copied or reset.

## Install

Apply this update over the current confirmed source checkout. Stop the development
app with Ctrl+C, then run:

```bash
cd /home/moo/Applications/mlearn-custom-source
unzip -o /home/moo/Downloads/mlearn-packaged-baseline.zip -d .
chmod +x scripts/install-mlearn-custom-linux.sh
./scripts/install-mlearn-custom-linux.sh
```

The installer checks the source and targeted embedded-player tests, builds one
x64 AppImage, and installs it here:

```text
/home/moo/Applications/mLearn-Custom/mLearn-Custom.AppImage
```

It registers `mLearn Custom` in KDE's application launcher. Search for it and
launch it. While running, right-click its taskbar icon and choose **Pin to Task
Manager**. Future launches use the embedded X11/mpv configuration automatically;
no terminal or development server is involved.

## Baseline and updates

Before building, the installer creates a timestamped baseline under:

```text
/home/moo/Applications/mLearn-Custom/baselines/
```

The snapshot contains the upstream git history, tracked custom patch, untracked
custom files, source status and base commit. If an older packaged AppImage exists,
it is copied into the new baseline before replacement. The installer does not
commit, reset, clean or change the current git branch/index.

Re-running the installer after future source changes creates another timestamped
baseline and replaces the installed AppImage. The desktop shortcut keeps the same
path, so the pinned taskbar entry continues to work.

## First packaged launch

The first launch may take longer while the existing Python runtime is checked.
Fontconfig, `fs.file-max`, or Intel VA-API warnings already seen in development
are not necessarily startup failures. Verify the player selector is mpv, embedded
video is checked, Continue restores the external subtitle, and one screenshot
flashcard captures the matching frame and sentence.

If KDE shows a second taskbar icon instead of grouping it with the pinned entry,
run `xprop WM_CLASS`, click the application window, and send the resulting line.
The launcher's `StartupWMClass` can then be matched to the value reported by KDE.
