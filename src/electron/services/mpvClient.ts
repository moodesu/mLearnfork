import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { type Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { MpvControl, MpvState, MpvTrack } from '../../shared/mpv';
import { INITIAL_MPV_STATE } from '../../shared/mpv';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.mpvClient');
const videoDiagnostics = ['current-vo', 'vo-configured', 'video-out-params', 'osd-dimensions'];

/** Resolve the bundled player in packaged builds; never silently use host mpv in strict standalone mode. */
export function resolveMpvExecutable(resourcesPath = process.resourcesPath, packaged = Boolean(process.env.APPIMAGE)) : string {
  const bundled = path.join(resourcesPath || '', 'bin', 'mpv');
  if (packaged && fs.existsSync(bundled)) return bundled;
  if (process.env.SORA_STANDALONE === '1') {
    throw new Error(`Standalone Sora requires a bundled mpv executable: ${bundled}`);
  }
  return 'mpv';
}

/** Validated commands only; no shell, arbitrary properties, or renderer-supplied flags. */
export function controlCommand(control: MpvControl): unknown[] {
  if (!control || typeof control !== 'object') throw new Error('Invalid player control');
  if (control.action === 'fullscreen') return ['cycle', 'fullscreen'];
  if (control.action === 'pause' && typeof control.value === 'boolean') {
    return ['set_property', 'pause', control.value];
  }
  if (control.action === 'audioTrack' || control.action === 'subtitleTrack') {
    if (control.value !== null && (!Number.isInteger(control.value) || control.value < 1)) {
      throw new Error('Invalid track ID');
    }
    return ['set_property', control.action === 'audioTrack' ? 'aid' : 'sid', control.value ?? 'no'];
  }
  if (typeof control.value !== 'number' || !Number.isFinite(control.value)) throw new Error('Invalid player value');
  switch (control.action) {
    case 'seek':
      if (control.value < 0) throw new Error('Invalid seek');
      return ['seek', control.value, 'absolute+exact'];
    case 'volume':
      if (control.value < 0 || control.value > 100) throw new Error('Invalid volume');
      return ['set_property', 'volume', control.value];
    case 'speed':
      if (control.value < 0.25 || control.value > 4) throw new Error('Invalid speed');
      return ['set_property', 'speed', control.value];
    case 'subtitleDelay':
      if (Math.abs(control.value) > 3600) throw new Error('Invalid subtitle delay');
      return ['set_property', 'sub-delay', control.value];
    default: throw new Error('Unsupported player control');
  }
}

const properties = ['time-pos', 'duration', 'pause', 'volume', 'speed', 'sub-delay', 'sub-text', 'sub-start', 'sub-end', 'track-list'];

export class MpvClient {
  private state: MpvState = { ...INITIAL_MPV_STATE, tracks: [] };
  private process: ChildProcess | null = null;
  private stream: Duplex | null = null;
  private requestId = 0;
  private diagnosticMessages = 0;
  private embedded = false;
  private loading: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly publish: (state: MpvState) => void, private readonly spawnProcess = spawn) {}

  async open(filePath: string, start: number, windowId?: number): Promise<void> {
    if (windowId !== undefined && (!Number.isSafeInteger(windowId) || windowId <= 0 || windowId > 0xffffffff)) {
      throw new Error('Invalid embedded video window');
    }
    this.close();
    this.embedded = windowId !== undefined;
    this.diagnosticMessages = 0;
    this.state = { ...INITIAL_MPV_STATE, tracks: [] };
    // A private inherited duplex pipe avoids public sockets and connection polling.
    // Linux first: Windows requires a different named-pipe transport.
    const child = this.spawnProcess(resolveMpvExecutable(), [
      '--no-config', '--input-ipc-client=fd://3', '--idle=yes', '--keep-open=yes',
      '--force-window=yes', '--pause=yes', '--terminal=no', '--load-scripts=no',
      '--ytdl=no', '--sub-auto=no', '--audio-file-auto=no', '--volume-max=100',
      '--demuxer=lavf',
      '--title=mLearn Custom — mpv',
      '--fullscreen=no',
      ...(windowId === undefined ? [] : [
        `--wid=${windowId}`, '--vo=gpu', '--gpu-context=x11egl', '--input-default-bindings=no',
        '--input-vo-keyboard=no', '--input-cursor=no', '--osc=no', '--window-dragging=no',
      ]),
      `--start=${start}`,
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'], shell: false });
    this.process = child;
    this.stream = child.stdio[3] as Duplex;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-4000);
      if (this.process === child) this.diagnostic('stderr', data.toString().slice(0, 2000));
    });
    const fail = (error: Error) => {
      if (this.process !== child) return;
      this.close();
      this.state = { ...this.state, error: error.message };
      this.emit();
    };
    child.on('error', (error) => fail(new Error(`Cannot start mpv: ${error.message}`)));
    child.on('exit', (code) => {
      if (this.process !== child) return;
      if (code && code !== 0) fail(new Error(`mpv exited (${code}): ${stderr}`));
      else this.close();
    });
    this.stream.on('error', fail);
    this.stream.on('end', () => { if (this.process === child) this.close(); });
    this.stream.on('data', (chunk: Buffer) => {
      if (this.process !== child) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 4 * 1024 * 1024) { fail(new Error('mpv IPC message too large')); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try { this.receive(JSON.parse(line)); } catch { /* Ignore non-JSON diagnostics. */ }
      }
    });
    try {
      await Promise.all(properties.map((property, index) => this.request(['observe_property', index, property])));
      if (this.embedded) {
        log.info('[EmbeddedVideo] mpv target window', windowId);
        // Diagnostics must never prevent playback on an older mpv version.
        await Promise.all(videoDiagnostics.map((property, index) =>
          this.request(['observe_property', properties.length + index, property])
            .catch(error => this.diagnostic(property, String(error)))));
      }
      if (this.process !== child) throw new Error('Player closed while opening');
      // loadfile only acknowledges a playlist change. sub-add must wait for the
      // actual file-loaded event, especially when restoring subtitles via Continue.
      const loaded = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => this.finishLoading(new Error('mpv file loading timed out')), 30000);
        this.loading = { resolve, reject, timer };
      });
      // `loadfile` accepts paths as JSON strings, not shell tokens, including spaces/Unicode.
      await Promise.all([this.request(['loadfile', filePath, 'replace']), loaded]);
      if (this.process !== child) throw new Error('Player closed while opening');
      this.state = { ...this.state, running: true };
      this.emit();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private emit(): void { this.publish({ ...this.state, tracks: [...this.state.tracks] }); }

  private diagnostic(name: string, value: unknown): void {
    if (this.embedded && this.diagnosticMessages++ < 100) {
      log.info('[EmbeddedVideo] mpv', name, JSON.stringify(value)?.slice(0, 2000) ?? 'unavailable');
    }
  }

  private finishLoading(error?: Error): void {
    const loading = this.loading;
    if (!loading) return;
    this.loading = null;
    clearTimeout(loading.timer);
    if (error) loading.reject(error);
    else loading.resolve();
  }

  private receive(message: { request_id?: number; error?: string; data?: unknown; event?: string; name?: string; reason?: string }): void {
    if (typeof message.request_id === 'number') {
      const pending = this.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.request_id);
        if (message.error === 'success') pending.resolve(message.data);
        else pending.reject(new Error(`mpv: ${message.error ?? 'command failed'}`));
      }
    }
    if (message.event === 'file-loaded') this.finishLoading();
    if (message.event === 'end-file') {
      this.finishLoading(new Error(`mpv stopped before loading: ${message.error ?? message.reason ?? 'unknown reason'}`));
    }
    if (message.event === 'end-file' && message.reason === 'error') {
      this.state = { ...this.state, error: `mpv could not load the media: ${message.error ?? 'decode error'}` };
      this.emit();
    }
    if (message.event !== 'property-change') return;
    if (message.name && videoDiagnostics.includes(message.name)) {
      this.diagnostic(message.name, message.data);
      return;
    }
    const data = message.data;
    const numeric: Record<string, keyof MpvState> = {
      'time-pos': 'position', duration: 'duration', volume: 'volume', speed: 'speed',
      'sub-delay': 'subtitleDelay', 'sub-start': 'subtitleStart', 'sub-end': 'subtitleEnd',
    };
    const key = message.name && numeric[message.name];
    if (key && typeof data === 'number' && Number.isFinite(data)) this.state = { ...this.state, [key]: data };
    if (message.name === 'pause' && typeof data === 'boolean') this.state.paused = data;
    if (message.name === 'sub-text') this.state.subtitleText = typeof data === 'string' ? data : '';
    if (message.name === 'track-list' && Array.isArray(data)) {
      this.state.tracks = data.filter((track): track is MpvTrack =>
        track && Number.isInteger(track.id) && ['audio', 'sub', 'video'].includes(track.type));
    }
    this.emit();
  }

  request(command: unknown[]): Promise<unknown> {
    const stream = this.stream;
    if (!stream || stream.destroyed) return Promise.reject(new Error('mpv is not running'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      // External process may hang; always settle IPC promises.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('mpv command timed out'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      // Synchronous JSON IPC blocks the connection's events as well as commands.
      // Await replies by ID, but let mpv keep servicing time/subtitle observations.
      stream.write(JSON.stringify({ command, request_id: id, async: true }) + '\n', (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) { clearTimeout(timer); this.pending.delete(id); pending.reject(error); }
      });
    });
  }

  close(): void {
    this.finishLoading(new Error('mpv closed before file finished loading'));
    const child = this.process;
    this.process = null;
    this.stream?.destroy();
    this.stream = null;
    child?.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('mpv closed'));
    }
    this.pending.clear();
    this.state = { ...this.state, running: false, paused: true, subtitleText: '' };
    this.emit();
  }
}
