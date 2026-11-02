import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const installer = 'scripts/install-mlearn-custom-linux.sh';
const source = readFileSync(installer, 'utf8');

describe('mLearn Custom Linux installer', () => {
  it('has valid shell syntax and a side-effect-free help path', () => {
    execFileSync('bash', ['-n', installer]);
    const help = execFileSync('bash', [installer, '--help'], { encoding: 'utf8' });
    expect(help).toContain('mLearn-Custom.AppImage');
  });

  it('preserves a source baseline and builds only the supported x64 AppImage', () => {
    expect(source).toContain('git bundle create "$baseline_dir/repository.bundle" --all');
    expect(source).toContain('git diff --binary HEAD > "$baseline_dir/tracked-changes.patch"');
    expect(source).toContain('untracked-files.tar.gz');
    expect(source).toContain('npm run build:extension');
    expect(source).toContain('electron-builder --linux AppImage --x64 --publish never');
    expect(source).not.toContain('git reset');
    expect(source).not.toContain('git clean');
  });

  it('launches the packaged app with the proven embedded X11 configuration', () => {
    expect(source).toContain('MLEARN_EMBEDDED_MPV=1');
    expect(source).toContain('--ozone-platform=x11');
    expect(source).toContain('local.moo.mlearncustom.desktop');
    expect(source).toContain('Pin to Task Manager');
  });
});
