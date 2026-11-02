import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
vi.mock('electron', () => ({ app: {}, ipcMain: {}, nativeImage: {} }));
import { validateMpvPath } from './mpvService';

describe('mpv local path validation', () => {
  it('rejects URLs, relative names, directories and missing files', async () => {
    for (const value of ['https://example.com/video', 'relative.mkv', '--script=evil', '/tmp/no\0file', null]) {
      await expect(validateMpvPath(value)).rejects.toThrow();
    }
    await expect(validateMpvPath(tmpdir())).rejects.toThrow('not a file');
    await expect(validateMpvPath('/nonexistent/mlearn/video.mkv')).rejects.toThrow();
  });
  it('accepts existing paths with spaces and Unicode', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mpv-path-test-'));
    const filePath = path.join(directory, '日本語 video.mkv');
    try {
      await writeFile(filePath, 'test');
      expect(await validateMpvPath(filePath)).toBe(filePath);
    } finally { await rm(directory, { recursive: true }); }
  });
});
