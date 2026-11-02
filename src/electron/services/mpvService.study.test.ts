import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MpvTrack } from '../../shared/mpv';
import { IPC_CHANNELS } from '../../shared/constants';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  request: vi.fn(), close: vi.fn(),
  transcript: vi.fn(async () => 'subtitles'), frame: vi.fn(async () => 'jpeg'), lookup: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({ app: { isPackaged: false, on: vi.fn() },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => mock.handlers.set(key, fn) }, nativeImage: {} }));
vi.mock('./mpvClient', () => ({ MpvClient: class {
  open = async () => {}; close = mock.close; request = mock.request;
}, controlCommand: (value: unknown) => value }));
vi.mock('./mpvStudyTools', async original => ({ ...(await original<typeof import('./mpvStudyTools')>()),
  extractTranscript: mock.transcript, captureSentenceFrame: mock.frame, lookupGoldenDict: mock.lookup }));
import { setupMpvIPC } from './mpvService';

describe('study IPC ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.handlers.clear(); setupMpvIPC(); });
  const owner = () => {
    const sender = Object.assign(new EventEmitter(), { id: 31, isDestroyed: () => false, mainFrame: {}, send: vi.fn(), getURL: () => 'http://localhost:3000/src/html/main.html' });
    return { sender, senderFrame: sender.mainFrame };
  };
  it('captures the live playback time independently without sending a screenshot command to mpv', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-frame-test-'));
    const event = owner();
    let finish!: (value: string) => void;
    try {
      const media = path.join(dir, 'video.mkv'); await writeFile(media, 'fixture');
      await mock.handlers.get(IPC_CHANNELS.MPV_OPEN)!(event, media, 0);
      mock.request.mockResolvedValue(355.25);
      mock.frame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const capture = mock.handlers.get(IPC_CHANNELS.MPV_SCREENSHOT)!(event);
      await vi.waitFor(() => expect(mock.frame).toHaveBeenCalled());
      expect(mock.frame).toHaveBeenCalledWith(media, 355.25, undefined, expect.any(AbortSignal));
      expect(mock.request).toHaveBeenCalledWith(['get_property', 'time-pos']);
      expect(mock.request.mock.calls.some(([command]) => command[0] === 'screenshot-to-file')).toBe(false);
      await mock.handlers.get(IPC_CHANNELS.MPV_CONTROL)!(event, { action: 'pause', value: true });
      // The control completes while the separate image decoder is still pending.
      finish('jpeg');
      expect(await capture).toBe('jpeg');
      mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event);
      const signal = mock.frame.mock.calls[0][3] as AbortSignal;
      expect(signal.aborted).toBe(true);
    } finally { mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event); await rm(dir, { recursive: true, force: true }); }
  });
  it('does not start a frame decoder if the session closes while obtaining its time', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-frame-close-test-'));
    const event = owner();
    try {
      const media = path.join(dir, 'video.mkv'); await writeFile(media, 'fixture');
      await mock.handlers.get(IPC_CHANNELS.MPV_OPEN)!(event, media, 0);
      let finish!: (value: number) => void;
      mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const capture = mock.handlers.get(IPC_CHANNELS.MPV_SCREENSHOT)!(event).catch((error: Error) => error);
      mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event);
      finish(355);
      expect((await capture).message).toBe('Player session changed');
      expect(mock.frame).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('uses the opened media and real stream index, caches the transcript, and cancels work on close', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-ipc-test-'));
    const event = owner();
    try {
      const media = path.join(dir, 'video.mkv'); await writeFile(media, 'fixture');
      await mock.handlers.get(IPC_CHANNELS.MPV_OPEN)!(event, media, 0);
      mock.request.mockImplementation(async (command: string[]) => command[1] === 'sid' ? 7 : [{ id: 7, type: 'sub', selected: true, 'ff-index': 3 }]);
      expect(await mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event)).toEqual({ trackId: 7, content: 'subtitles' });
      expect(mock.transcript).toHaveBeenCalledWith(media, '0:3', undefined, expect.any(AbortSignal));
      await mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event);
      expect(mock.transcript).toHaveBeenCalledTimes(1);
      await mock.handlers.get(IPC_CHANNELS.MPV_SCREENSHOT_AT)!(event, 12.5);
      expect(mock.frame).toHaveBeenCalledWith(media, 12.5, undefined, expect.any(AbortSignal));
      const signal = vi.mocked(mock.transcript).mock.calls[0][3] as AbortSignal;
      mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event);
      expect(signal.aborted).toBe(true);
      await expect(mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event)).rejects.toThrow('not running');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects iframe/plugin requests before lookup or native execution', () => {
    const event = owner();
    expect(() => mock.handlers.get(IPC_CHANNELS.MPV_LOOKUP)!({ ...event, senderFrame: {} }, 'word')).toThrow('Untrusted');
    event.sender.getURL = () => 'http://localhost:3000/src/html/plugin-host.html';
    expect(() => mock.handlers.get(IPC_CHANNELS.MPV_LOOKUP)!(event, 'word')).toThrow('Untrusted');
    expect(mock.lookup).not.toHaveBeenCalled();
  });
  it('keeps the actual opened ASS paths per subtitle track even when mpv reports a non-file name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-external-test-'));
    const event = owner();
    try {
      const media = path.join(dir, 'video.mkv'); await writeFile(media, 'fixture');
      const first = path.join(dir, '日本 語.ass'); await writeFile(first, 'first');
      const second = path.join(dir, 'second.ass'); await writeFile(second, 'second');
      await mock.handlers.get(IPC_CHANNELS.MPV_OPEN)!(event, media, 0);
      // Audio ID 1 must not be mistaken for an existing subtitle ID 1.
      const tracks: MpvTrack[] = [{ id: 1, type: 'audio' }]; let sid = 0;
      mock.request.mockImplementation(async (command: string[]) => {
        if (command[0] === 'sub-add') {
          sid++;
          tracks.push({ id: sid, type: 'sub', selected: true, external: true, 'external-filename': 'memory://opaque' });
          return;
        }
        return command[1] === 'sid' ? sid : [...tracks];
      });
      // A transcript request may arrive while the sub-add command is still pending.
      const adding = mock.handlers.get(IPC_CHANNELS.MPV_SUBTITLE)!(event, first);
      const result = mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event);
      await adding;
      expect(await result).toEqual({ trackId: 1, content: 'subtitles' });
      expect(mock.transcript).toHaveBeenLastCalledWith(first, '0:s:0', undefined, expect.any(AbortSignal));
      await mock.handlers.get(IPC_CHANNELS.MPV_SUBTITLE)!(event, second);
      await mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event);
      expect(mock.transcript).toHaveBeenLastCalledWith(second, '0:s:0', undefined, expect.any(AbortSignal));
      sid = 1;
      await mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event);
      expect(mock.transcript).toHaveBeenCalledTimes(2); // original track retains its own cache
    } finally { mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event); await rm(dir, { recursive: true, force: true }); }
  });
  it('accepts a local file URL from mpv metadata without relaxing renderer path validation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mlearn-url-test-'));
    const event = owner();
    try {
      const media = path.join(dir, 'video.mkv'); await writeFile(media, 'fixture');
      const subs = path.join(dir, '日本 語.ass'); await writeFile(subs, 'fixture');
      await mock.handlers.get(IPC_CHANNELS.MPV_OPEN)!(event, media, 0);
      mock.request.mockImplementation(async (command: string[]) => command[1] === 'sid' ? 2 : [
        { id: 2, type: 'sub', external: true, 'external-filename': pathToFileURL(subs).href },
      ]);
      await mock.handlers.get(IPC_CHANNELS.MPV_TRANSCRIPT)!(event);
      expect(mock.transcript).toHaveBeenCalledWith(subs, '0:s:0', undefined, expect.any(AbortSignal));
    } finally { mock.handlers.get(IPC_CHANNELS.MPV_CLOSE)!(event); await rm(dir, { recursive: true, force: true }); }
  });
});
