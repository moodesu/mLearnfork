import { describe, expect, it, vi } from 'vitest';
import { captureSentenceFrame, externalSubtitlePath, extractTranscript, lookupGoldenDict, transcriptInput } from './mpvStudyTools';

describe('native study tools', () => {
  it('normalizes local metadata without guessing media-relative paths or allowing remote protocols', () => {
    expect(externalSubtitlePath('file:///tmp/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.ass', '/work')).toBe('/tmp/日本 語.ass');
    expect(externalSubtitlePath('subs/日本 語.ass', '/work')).toBe('/work/subs/日本 語.ass');
    expect(externalSubtitlePath('/tmp/100% subtitles.ass', '/work')).toBe('/tmp/100% subtitles.ass');
    for (const value of ['https://example.com/a.ass', 'memory://subtitles', 'file://remote/a.ass', '', 'a\0b']) {
      expect(() => externalSubtitlePath(value, '/work')).toThrow();
    }
  });
  it('uses the selected track stream index, not its mpv ID', () => {
    expect(transcriptInput('/a.mkv', { id: 7, type: 'sub', selected: true, 'ff-index': 3 })).toEqual({ path: '/a.mkv', map: '0:3' });
    expect(transcriptInput('/a.mkv', { id: 7, type: 'sub', selected: true, external: true, 'external-filename': '/日本 語.ass' }))
      .toEqual({ path: '/日本 語.ass', map: '0:s:0' });
    expect(() => transcriptInput('/a', { id: 2, type: 'sub', selected: true })).toThrow('index unavailable');
    expect(() => transcriptInput('/a', { id: 2, type: 'sub', selected: true, codec: 'hdmv_pgs_subtitle' })).toThrow('Bitmap');
  });
  it('converts subtitle content with bounded native execution and no shell interpolation', async () => {
    const run = vi.fn(async () => Buffer.from('字幕'));
    const abort = new AbortController();
    expect(await extractTranscript('/tmp/name $(touch nope).ass', '0:s:0', run, abort.signal)).toBe('字幕');
    expect(run.mock.calls[0]).toEqual(['ffmpeg', expect.arrayContaining(['-protocol_whitelist', 'file,pipe', '-i', '/tmp/name $(touch nope).ass', '-map', '0:s:0', '-f', 'srt', 'pipe:1']), abort.signal]);
    await expect(extractTranscript('/a', '0;evil', run)).rejects.toThrow('Invalid');
    const missing = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    await expect(extractTranscript('/a', '0:2', missing)).rejects.toThrow('Install ffmpeg');
  });
  it('captures the requested timestamp without seeking the live player', async () => {
    const run = vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0x01]));
    expect(await captureSentenceFrame('/a.mkv', 173.5, run)).toMatch(/^data:image\/jpeg;base64,/);
    expect(run.mock.calls[0]).toEqual(['ffmpeg', expect.arrayContaining(['-ss', '173.5', '-frames:v', '1', '-an', '-sn']), undefined]);
    for (const value of [-1, NaN, Infinity, '1', null, 800000]) await expect(captureSentenceFrame('/a', value, run)).rejects.toThrow('Invalid screenshot');
    await expect(captureSentenceFrame('/a', 3, async () => Buffer.alloc(0))).rejects.toThrow('Could not capture');
  });
  it('sends Unicode words as arguments to GoldenDict and tries only known executable names', async () => {
    const run = vi.fn(async (executable: string) => {
      if (executable === 'goldendict') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Buffer.alloc(0);
    });
    await lookupGoldenDict(' 食べる ', run);
    expect(run.mock.calls).toEqual([['goldendict', ['--main-window', '食べる']], ['goldendict-ng', ['--main-window', '食べる']]]);
    await lookupGoldenDict('word;$(not-a-command)', async (_exe, args) => {
      expect(args).toEqual(['--main-window', 'word;$(not-a-command)']); return Buffer.alloc(0);
    });
    for (const value of ['', '--no-tts', '  -bad', 'a\nb', '\0', 'a'.repeat(257), null]) await expect(lookupGoldenDict(value, run)).rejects.toThrow('Invalid');
  });
  it('reports missing dictionaries executable and does not bypass other launch failures', async () => {
    const missing = async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
    await expect(lookupGoldenDict('word', missing, missing)).rejects.toThrow('native command or installed Flatpak');
    const denied = vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    await expect(lookupGoldenDict('word', denied)).rejects.toThrow('denied');
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it('uses the installed Flatpak with the confirmed main-window flag and a separate word argument', async () => {
    const run = vi.fn(async (exe: string) => {
      if (exe !== 'flatpak') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Buffer.alloc(0);
    });
    const probe = vi.fn(async () => Buffer.from('installed'));
    await lookupGoldenDict(' 沈黙 ', run, probe);
    expect(probe).toHaveBeenCalledWith('flatpak', ['info', 'io.github.xiaoyifang.goldendict_ng']);
    expect(run).toHaveBeenLastCalledWith('flatpak', ['run', 'io.github.xiaoyifang.goldendict_ng', '--main-window', '沈黙']);
    run.mockClear();
    await expect(lookupGoldenDict('word', run, async () => { throw new Error('not installed'); })).rejects.toThrow('not installed');
    expect(run.mock.calls.every(([exe]) => exe !== 'flatpak')).toBe(true);
  });
});
