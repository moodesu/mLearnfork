import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { endianness } from 'node:os';
import { IPC_CHANNELS } from '../../shared/constants';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  open: vi.fn(async () => {}), close: vi.fn(), request: vi.fn(),
  hostOpen: vi.fn(async () => 456), hostClose: vi.fn(), viewport: vi.fn(),
  fullscreen: vi.fn(), hostFailure: null as ((error: Error) => void) | null,
}));
vi.mock('node:fs/promises', () => ({ default: { realpath: async (value: string) => value, stat: async () => ({ isFile: () => true }) } }));
vi.mock('electron', () => ({
  app: { isPackaged: false, on: vi.fn(), commandLine: { getSwitchValue: () => 'x11' } },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mock.handlers.set(channel, handler) },
  nativeImage: {},
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, isFullScreen: () => false,
    setFullScreen: mock.fullscreen, getNativeWindowHandle: () => {
      const value = Buffer.alloc(8);
      if (endianness() === 'LE') value.writeBigUInt64LE(123n); else value.writeBigUInt64BE(123n);
      return value;
    } }) },
}));
vi.mock('./mpvClient', () => ({ MpvClient: class { open = mock.open; close = mock.close; request = mock.request; },
  controlCommand: (value: unknown) => value }));
vi.mock('./mpvX11Host', async original => ({ ...(await original<typeof import('./mpvX11Host')>()), MpvX11Host: class {
  constructor(failure: (error: Error) => void) { mock.hostFailure = failure; }
  open = mock.hostOpen; close = mock.hostClose; update = mock.viewport;
} }));
import { setupMpvIPC } from './mpvService';

const viewport = { x: 10, y: 50, width: 400, height: 225, viewportWidth: 1200, viewportHeight: 800, visible: true };
function owner() {
  const sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: {}, isDestroyed: () => false,
    send: vi.fn(), getURL: () => 'http://localhost:3000/src/html/main.html' });
  return { sender, senderFrame: sender.mainFrame };
}
function invoke(channel: string, ...args: any[]) { return mock.handlers.get(channel)!(...args); }

describe('embedded mpv owner lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.handlers.clear(); mock.hostOpen.mockResolvedValue(456);
    vi.stubEnv('MLEARN_EMBEDDED_MPV', '1'); vi.stubEnv('DISPLAY', ':99');
    setupMpvIPC();
  });
  afterEach(() => vi.unstubAllEnvs());
  it('requires app-local X11 opt-in and never embeds from a normal launch', async () => {
    vi.stubEnv('MLEARN_EMBEDDED_MPV', '');
    const event = owner();
    expect(invoke(IPC_CHANNELS.MPV_EMBEDDING_AVAILABLE, event)).toBe(false);
    await expect(invoke(IPC_CHANNELS.MPV_OPEN, event, '/tmp/movie.mkv', 0, viewport)).rejects.toThrow('dev:embedded');
    expect(mock.hostOpen).not.toHaveBeenCalled();
  });
  it('owns the native handle, resizes the child, and fullscreens the app, not mpv', async () => {
    const event = owner();
    expect(invoke(IPC_CHANNELS.MPV_EMBEDDING_AVAILABLE, event)).toBe(true);
    await invoke(IPC_CHANNELS.MPV_OPEN, event, '/tmp/movie.mkv', 42, viewport);
    expect(mock.hostOpen).toHaveBeenCalledWith(123);
    expect(mock.open).toHaveBeenCalledWith('/tmp/movie.mkv', 42, 456);
    expect(mock.viewport).toHaveBeenCalledWith({ ...viewport, visible: false });
    invoke(IPC_CHANNELS.MPV_VIEWPORT, event, viewport);
    expect(mock.viewport).toHaveBeenLastCalledWith(viewport);
    await invoke(IPC_CHANNELS.MPV_CONTROL, event, { action: 'fullscreen' });
    expect(mock.fullscreen).toHaveBeenCalledWith(true);
    expect(mock.request).not.toHaveBeenCalled();
    event.sender.emit('destroyed');
    expect(mock.close).toHaveBeenCalled(); expect(mock.hostClose).toHaveBeenCalledOnce();
  });
  it('does not launch mpv if the user leaves while the child host is starting', async () => {
    let finish!: (value: number) => void;
    mock.hostOpen.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const event = owner();
    const opening = invoke(IPC_CHANNELS.MPV_OPEN, event, '/tmp/movie.mkv', 0, viewport).catch((error: Error) => error);
    await vi.waitFor(() => expect(mock.hostOpen).toHaveBeenCalled());
    invoke(IPC_CHANNELS.MPV_CLOSE, event);
    finish(456);
    expect((await opening).message).toContain('cancelled');
    expect(mock.open).not.toHaveBeenCalled();
    expect(mock.hostClose).toHaveBeenCalledOnce();
  });
  it('closes mpv if its native host fails and reports a useful error', async () => {
    const event = owner();
    await invoke(IPC_CHANNELS.MPV_OPEN, event, '/tmp/movie.mkv', 0, viewport);
    mock.hostFailure?.(new Error('X11 connection lost'));
    expect(mock.close).toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.MPV_STATE, expect.objectContaining({ running: false, error: 'X11 connection lost' }));
  });
});
