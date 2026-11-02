import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureSentenceFrame, extractTranscript, runStudyTool } from './mpvStudyTools';

describe('real FFmpeg study pipeline', () => {
  it.skipIf(!existsSync('/usr/bin/ffmpeg'))('extracts external/embedded text and a JPEG from a Unicode media path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-study-test-'));
    try {
      const subs = path.join(dir, '日本 語.srt');
      const ass = path.join(dir, '外部 字幕.ass');
      const video = path.join(dir, '動画 $(literal).mkv');
      await writeFile(subs, '1\n00:00:00,200 --> 00:00:01,500\n王国の話\n');
      await runStudyTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', subs, ass]);
      const externalAss = await extractTranscript(ass, '0:s:0');
      expect(externalAss).toContain('王国の話');
      expect(externalAss).toContain('00:00:00,200 --> 00:00:01,500');
      await runStudyTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2', '-i', subs,
        '-map', '0:v:0', '-map', '1:s:0', '-c:v', 'mpeg4', '-c:s', 'srt', video]);
      const external = await extractTranscript(subs, '0:s:0');
      const embedded = await extractTranscript(video, '0:1');
      expect(external).toContain('王国の話'); expect(embedded).toContain('王国の話');
      expect(embedded).toContain('00:00:00,200 --> 00:00:01,500');
      const image = await captureSentenceFrame(video, 0.85);
      expect(image).toMatch(/^data:image\/jpeg;base64,\/9j\//);
      expect(image.length).toBeGreaterThan(500);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
