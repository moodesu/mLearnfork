import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { controlCommand, MpvClient, resolveMpvExecutable } from './mpvClient';
import type { MpvControl, MpvState } from '../../shared/mpv';

function fakeProcess(autoReply = true, autoLoad = true, holdCommand?: string) {
  const commands: { command: unknown[]; request_id: number; async?: boolean }[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.toString());
      commands.push(request);
      if (autoReply && request.command[0] !== holdCommand) queueMicrotask(() => {
        stream.push(JSON.stringify({ request_id: request.request_id, error: 'success' }) + '\n');
        if (autoLoad && request.command[0] === 'loadfile') stream.push(JSON.stringify({ event: 'file-loaded' }) + '\n');
      });
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, stream], stderr: new PassThrough(), kill: vi.fn(),
  });
  const spawnMock = vi.fn(() => child);
  return { child, stream, commands, spawnMock, spawn: spawnMock as unknown as typeof spawn };
}

describe('mpv command boundary', () => {
  it('uses track IDs, supports off, and does not expose shell/property commands', () => {
    expect(controlCommand({ action: 'audioTrack', value: 3 })).toEqual(['set_property', 'aid', 3]);
    expect(controlCommand({ action: 'subtitleTrack', value: null })).toEqual(['set_property', 'sid', 'no']);
    expect(controlCommand({ action: 'subtitleDelay', value: 84.8 })).toEqual(['set_property', 'sub-delay', 84.8]);
    expect(controlCommand({ action: 'seek', value: 173 })).toEqual(['seek', 173, 'absolute+exact']);
    for (const control of [
      { action: 'run', value: 'sh' }, { action: 'pause', value: 'yes' },
      { action: 'seek', value: NaN }, { action: 'audioTrack', value: -1 },
      { action: 'volume', value: 200 }, { action: 'speed', value: 0 },
    ]) expect(() => controlCommand(control as MpvControl)).toThrow();
  });
});

describe('mpv process and IPC lifecycle', () => {
  it('uses async IPC and handles time/subtitle events and controls before a slow command completes', async () => {
    const fake = fakeProcess(true, true, 'sub-add');
    const states: MpvState[] = [];
    const client = new MpvClient(state => states.push(state), fake.spawn);
    await client.open('/tmp/movie.mkv', 0);
    const adding = client.request(['sub-add', '/tmp/subs.ass', 'select']);
    const held = fake.commands.at(-1)!;
    expect(held.async).toBe(true);
    await client.request(['set_property', 'pause', true]);
    fake.stream.push(JSON.stringify({ event: 'property-change', name: 'time-pos', data: 355 }) + '\n');
    fake.stream.push(JSON.stringify({ event: 'property-change', name: 'sub-text', data: 'new sentence' }) + '\n');
    await new Promise(resolve => setImmediate(resolve));
    expect(states.at(-1)).toMatchObject({ position: 355, subtitleText: 'new sentence' });
    fake.stream.push(JSON.stringify({ request_id: held.request_id, error: 'success', data: 'finished' }) + '\n');
    expect(await adding).toBe('finished');
    expect(fake.commands.every(request => request.async === true)).toBe(true);
    client.close();
  });
  it('embeds only into a validated native child, with X11 and fullscreen disabled', async () => {
    const fake = fakeProcess();
    const client = new MpvClient(() => {}, fake.spawn);
    for (const id of [0, -1, NaN, 1.5, 0x100000000]) await expect(client.open('/tmp/movie.mkv', 0, id)).rejects.toThrow('Invalid embedded');
    expect(fake.spawnMock).not.toHaveBeenCalled();
    await client.open('/tmp/movie.mkv', 0, 12345);
    expect(fake.spawnMock).toHaveBeenCalledWith('mpv', expect.arrayContaining([
      '--wid=12345', '--gpu-context=x11egl', '--vo=gpu', '--fullscreen=no', '--input-default-bindings=no',
    ]), expect.objectContaining({ shell: false }));
    expect(fake.commands.some(({ command }) => command[0] === 'observe_property' && command[2] === 'vo-configured')).toBe(true);
    client.close();
  });
  it('does not observe video diagnostics in the standalone player', async () => {
    const fake = fakeProcess();
    const client = new MpvClient(() => {}, fake.spawn);
    await client.open('/tmp/movie.mkv', 0);
    expect(fake.commands.some(({ command }) => command[2] === 'vo-configured')).toBe(false);
    client.close();
  });
  it('does not add Continue subtitles until file-loaded, even after loadfile succeeds', async () => {
    const fake = fakeProcess(true, false);
    const states: MpvState[] = [];
    const client = new MpvClient(state => states.push(state), fake.spawn);
    const resumed = client.open('/tmp/video.mkv', 152).then(() => client.request(['sub-add', '/tmp/saved.ass', 'select']));
    try {
      await vi.waitFor(() => expect(fake.commands.some(request => request.command[0] === 'loadfile')).toBe(true));
      expect(states.some(state => state.running)).toBe(false);
      expect(fake.commands.some(request => request.command[0] === 'sub-add')).toBe(false);
      fake.stream.push(JSON.stringify({ event: 'file-loaded' }) + '\n');
      await resumed;
      expect(fake.commands.at(-1)?.command).toEqual(['sub-add', '/tmp/saved.ass', 'select']);
      expect(states.at(-1)?.running).toBe(true);
    } finally { client.close(); }
  });

  it.each(['close', 'error', 'exit'] as const)('settles pending file loading on %s without adding subtitles', async kind => {
    const fake = fakeProcess(true, false);
    const client = new MpvClient(() => {}, fake.spawn);
    const result = client.open('/tmp/video.mkv', 0).catch(error => error);
    await vi.waitFor(() => expect(fake.commands.some(request => request.command[0] === 'loadfile')).toBe(true));
    if (kind === 'close') client.close();
    else if (kind === 'exit') fake.child.emit('exit', 1);
    else fake.stream.push(JSON.stringify({ event: 'end-file', reason: 'error', error: 'loading failed' }) + '\n');
    expect(await result).toBeInstanceOf(Error);
    expect(fake.child.kill).toHaveBeenCalledOnce();
  });

  it('times out a missing file-loaded event after the command was acknowledged', async () => {
    vi.useFakeTimers();
    const fake = fakeProcess(true, false);
    const client = new MpvClient(() => {}, fake.spawn);
    try {
      const result = client.open('/tmp/video.mkv', 0).catch(error => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.commands.some(request => request.command[0] === 'loadfile')).toBe(true);
      await vi.advanceTimersByTimeAsync(30001);
      expect((await result).message).toBe('mpv file loading timed out');
      expect(fake.child.kill).toHaveBeenCalledOnce();
    } finally { client.close(); vi.useRealTimers(); }
  });

  it('opens Unicode paths without a shell and observes state', async () => {
    const fake = fakeProcess();
    const states: MpvState[] = [];
    const client = new MpvClient(state => states.push(state), fake.spawn);
    await client.open('/tmp/日本語 video $(no).mkv', 84.8);
    expect(fake.spawnMock).toHaveBeenCalledWith('mpv', expect.arrayContaining(['--no-config', '--input-ipc-client=fd://3', '--start=84.8']), expect.objectContaining({ shell: false }));
    expect(fake.commands.at(-1)?.command).toEqual(['loadfile', '/tmp/日本語 video $(no).mkv', 'replace']);
    expect(states.at(-1)?.running).toBe(true);
    const message = Buffer.from(JSON.stringify({ event: 'property-change', name: 'sub-text', data: '日本語' }) + '\n');
    const split = message.indexOf(Buffer.from('日')) + 1;
    fake.stream.push(message.subarray(0, split));
    fake.stream.push(message.subarray(split));
    await new Promise(resolve => setImmediate(resolve));
    expect(states.at(-1)?.subtitleText).toBe('日本語');
    client.close();
    expect(fake.child.kill).toHaveBeenCalledOnce();
    expect(states.at(-1)?.running).toBe(false);
  });

  it('rejects pending requests when the process fails', async () => {
    const fake = fakeProcess(false);
    const states: MpvState[] = [];
    const client = new MpvClient(state => states.push(state), fake.spawn);
    const opening = client.open('/tmp/video.mkv', 0);
    fake.child.emit('error', new Error('ENOENT'));
    await expect(opening).rejects.toThrow();
    expect(states.some(state => state.error?.includes('Cannot start mpv'))).toBe(true);
    await expect(client.request(['get_property', 'pause'])).rejects.toThrow('not running');
  });

  it('times out unresponsive commands rather than leaving callers blocked', async () => {
    vi.useFakeTimers();
    const fake = fakeProcess(false);
    const client = new MpvClient(() => {}, fake.spawn);
    const result = client.open('/tmp/video.mkv', 0).catch(error => error);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await result).message).toContain('timed out');
    client.close();
    vi.useRealTimers();
  });

  it('ignores events from an old process after reopening', async () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const factory = vi.fn().mockReturnValueOnce(first.child).mockReturnValueOnce(second.child);
    const states: MpvState[] = [];
    const client = new MpvClient(state => states.push(state), factory as unknown as typeof spawn);
    await client.open('/tmp/first.mkv', 0);
    await client.open('/tmp/second.mkv', 0);
    first.child.emit('exit', 1);
    expect(states.at(-1)?.running).toBe(true);
    expect(second.child.kill).not.toHaveBeenCalled();
    client.close();
  });
});

// Strict standalone packaging must never silently use /usr/bin/mpv.
describe('standalone mpv resolution', () => {
  it('fails explicitly when bundled mpv is absent', () => {
    const old = process.env.SORA_STANDALONE;
    try {
      process.env.SORA_STANDALONE = '1';
      expect(() => resolveMpvExecutable('/no-such-sora-resource-dir', true)).toThrow('bundled mpv');
    } finally {
      if (old === undefined) delete process.env.SORA_STANDALONE;
      else process.env.SORA_STANDALONE = old;
    }
  });
});
