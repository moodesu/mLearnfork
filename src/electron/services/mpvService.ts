import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from 'node:process';
import { IPC_CHANNELS } from '../../shared/constants';
import type { MpvControl, MpvTrack } from '../../shared/mpv';
import { MpvClient, controlCommand } from './mpvClient';
import { MpvX11Host, nativeX11Id, validateViewport } from './mpvX11Host';
import { captureSentenceFrame, externalSubtitlePath, extractTranscript, lookupGoldenDict, transcriptInput } from './mpvStudyTools';

export async function validateMpvPath(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error('mpv requires an absolute local file path');
  }
  const resolved = await fs.realpath(value);
  if (!(await fs.stat(resolved)).isFile()) throw new Error('Media path is not a file');
  return resolved;
}

export function setupMpvIPC(): void {
  const sessions = new Map<number, MpvClient>();
  const hosts = new Map<number, MpvX11Host>();
  const embeddingAvailable = () => process.platform === 'linux' && env.MLEARN_EMBEDDED_MPV === '1' &&
    !!env.DISPLAY && app.commandLine.getSwitchValue('ozone-platform') === 'x11';
  const generations = new Map<number, number>();
  const study = new Map<number, { path: string; cwd: string; abort: AbortController;
    transcripts: Map<string, Promise<string>>; externalPaths: Map<number, string>; subtitleLoad: Promise<void> }>();
  const closeSession = (id: number) => {
    study.get(id)?.abort.abort(); study.delete(id);
    sessions.get(id)?.close(); sessions.delete(id);
    hosts.get(id)?.close(); hosts.delete(id);
  };
  const getClient = (event: IpcMainInvokeEvent): MpvClient => {
    const client = sessions.get(event.sender.id);
    if (!client) throw new Error('mpv is not running');
    return client;
  };
  const checkSender = (event: IpcMainInvokeEvent): void => {
    const url = new URL(event.sender.getURL());
    if (url.pathname.includes('plugin-host') || event.senderFrame !== event.sender.mainFrame ||
        !(url.protocol === 'file:' || (!app.isPackaged && url.origin === 'http://localhost:3000'))) {
      throw new Error('Untrusted player request');
    }
  };
  const register = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => { checkSender(event); return handler(event, ...args); });
  };
  const owners = new WeakSet<WebContents>();
  register(IPC_CHANNELS.MPV_EMBEDDING_AVAILABLE, () => embeddingAvailable());
  register(IPC_CHANNELS.MPV_VIEWPORT, (event, viewport: unknown) => {
    const bounds = validateViewport(viewport);
    hosts.get(event.sender.id)?.update(bounds);
  });
  register(IPC_CHANNELS.MPV_OPEN, async (event, filePath: unknown, start: unknown, viewport?: unknown) => {
    if (process.platform !== 'linux') throw new Error('The mpv prototype currently supports Linux only');
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) throw new Error('Invalid start time');
    const bounds = viewport === undefined ? undefined : validateViewport(viewport);
    if (bounds && !embeddingAvailable()) throw new Error('Embedded mode requires npm run dev:embedded (XWayland)');
    const owner = event.sender;
    const generation = (generations.get(owner.id) ?? 0) + 1;
    generations.set(owner.id, generation);
    const resolved = await validateMpvPath(filePath);
    // Validation can outlive a window; never launch for a destroyed owner.
    if (owner.isDestroyed() || generations.get(owner.id) !== generation) throw new Error('Player open cancelled');
    closeSession(owner.id);
    const client = new MpvClient(state => {
      if (!owner.isDestroyed() && sessions.get(owner.id) === client) owner.send(IPC_CHANNELS.MPV_STATE, state);
      if (state.error && sessions.get(owner.id) === client) { hosts.get(owner.id)?.close(); hosts.delete(owner.id); }
    });
    sessions.set(owner.id, client);
    study.set(owner.id, { path: resolved, cwd: process.cwd(), abort: new AbortController(),
      transcripts: new Map(), externalPaths: new Map(), subtitleLoad: Promise.resolve() });
    if (!owners.has(owner)) {
      owners.add(owner);
      const dispose = () => { closeSession(owner.id); generations.delete(owner.id); };
      owner.once('destroyed', dispose);
      owner.on('render-process-gone', dispose);
      owner.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) dispose();
      });
    }
    try {
      let windowId: number | undefined;
      if (bounds) {
        const window = BrowserWindow.fromWebContents(owner);
        if (!window || window.isDestroyed()) throw new Error('Player window unavailable');
        const host = new MpvX11Host(error => {
          if (sessions.get(owner.id) !== client) return;
          closeSession(owner.id);
          if (!owner.isDestroyed()) owner.send(IPC_CHANNELS.MPV_STATE, {
            running: false, paused: true, position: start, duration: 0, volume: 100, speed: 1,
            subtitleDelay: 0, subtitleText: '', subtitleStart: 0, subtitleEnd: 0, tracks: [], error: error.message,
          });
        });
        hosts.set(owner.id, host);
        // Only main obtains the native handle; renderer cannot target other windows.
        windowId = await host.open(nativeX11Id(window.getNativeWindowHandle()));
        if (owner.isDestroyed() || generations.get(owner.id) !== generation) throw new Error('Player open cancelled');
        host.update({ ...bounds, visible: false });
      }
      await client.open(resolved, start, windowId);
    } catch (error) {
      if (sessions.get(owner.id) === client) closeSession(owner.id);
      throw error;
    }
  });
  register(IPC_CHANNELS.MPV_CLOSE, event => {
    generations.set(event.sender.id, (generations.get(event.sender.id) ?? 0) + 1);
    closeSession(event.sender.id);
  });
  register(IPC_CHANNELS.MPV_CONTROL, async (event, control: MpvControl) => {
    const client = getClient(event);
    const command = controlCommand(control);
    if (control.action === 'fullscreen' && hosts.has(event.sender.id)) {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window && !window.isDestroyed()) window.setFullScreen(!window.isFullScreen());
    } else await client.request(command);
  });
  register(IPC_CHANNELS.MPV_SUBTITLE, async (event, filePath: unknown) => {
    const client = getClient(event);
    const session = study.get(event.sender.id);
    if (!session) throw new Error('Player session unavailable');
    const load = session.subtitleLoad.then(async () => {
      const resolved = await validateMpvPath(filePath);
      if (!/\.(ass|ssa|srt|vtt|sub|idx|sup)$/i.test(resolved)) throw new Error('Unsupported subtitle file');
      if (study.get(event.sender.id) !== session) throw new Error('Player session changed');
      const before = await client.request(['get_property', 'track-list']);
      const ids = new Set((Array.isArray(before) ? before as MpvTrack[] : [])
        .filter(track => track.type === 'sub').map(track => track.id));
      await client.request(['sub-add', resolved, 'select']);
      const after = await client.request(['get_property', 'track-list']);
      const added = (Array.isArray(after) ? after as MpvTrack[] : [])
        .filter(track => track.type === 'sub' && track.external && !ids.has(track.id));
      // Keep the exact file opened in mLearn, keyed by track (not just the latest file).
      if (added.length === 1) session.externalPaths.set(added[0].id, resolved);
    });
    session.subtitleLoad = load.catch(() => {});
    await load;
  });
  register(IPC_CHANNELS.MPV_TRANSCRIPT, async event => {
    const client = getClient(event);
    const session = study.get(event.sender.id);
    if (!session) throw new Error('Player session unavailable');
    await session.subtitleLoad;
    if (study.get(event.sender.id) !== session) throw new Error('Player session changed');
    const [rawTracks, sid] = await Promise.all([
      client.request(['get_property', 'track-list']), client.request(['get_property', 'sid']),
    ]);
    const track = (Array.isArray(rawTracks) ? rawTracks as MpvTrack[] : []).find(item => item.type === 'sub' && item.id === Number(sid));
    if (!track) return { trackId: null, content: '' };
    const knownPath = session.externalPaths.get(track.id);
    const input = transcriptInput(session.path, { ...track, selected: true,
      ...(knownPath ? { 'external-filename': knownPath } : {}) });
    if (track.external) input.path = externalSubtitlePath(input.path, session.cwd);
    const resolved = await validateMpvPath(input.path);
    const stat = await fs.stat(resolved);
    const key = JSON.stringify([track.id, resolved, input.map, stat.mtimeMs, stat.size]);
    let content = session.transcripts.get(key);
    if (!content) {
      if (session.transcripts.size >= 4) session.transcripts.clear();
      content = extractTranscript(resolved, input.map, undefined, session.abort.signal);
      session.transcripts.set(key, content);
      void content.catch(() => session.transcripts.delete(key));
    }
    const result = await content;
    if (study.get(event.sender.id) !== session) throw new Error('Player session changed');
    return { trackId: track.id, content: result };
  });
  register(IPC_CHANNELS.MPV_SCREENSHOT_AT, async (event, time: unknown) => {
    getClient(event);
    const session = study.get(event.sender.id);
    if (!session) throw new Error('Player session unavailable');
    return captureSentenceFrame(session.path, time, undefined, session.abort.signal);
  });
  register(IPC_CHANNELS.MPV_LOOKUP, (_event, word: unknown) => lookupGoldenDict(word));
  register(IPC_CHANNELS.MPV_SCREENSHOT, async event => {
    const client = getClient(event);
    const session = study.get(event.sender.id);
    if (!session) throw new Error('Player session unavailable');
    // Read the live time, not a possibly stale renderer time. Decode independently
    // of the native video surface: an unmapped/covered X11 window must not hang
    // screenshots or the player's command/event channel.
    const time = await client.request(['get_property', 'time-pos']);
    if (study.get(event.sender.id) !== session) throw new Error('Player session changed');
    return captureSentenceFrame(session.path, time, undefined, session.abort.signal);
  });
  app.on('before-quit', () => { for (const id of sessions.keys()) closeSession(id); });
}
