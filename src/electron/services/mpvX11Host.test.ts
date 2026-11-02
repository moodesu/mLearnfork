import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync, type spawn } from 'node:child_process';
import { endianness } from 'node:os';
import { MpvX11Host, nativeX11Id, validateViewport, X11_HOST_SCRIPT } from './mpvX11Host';

const bounds = { x: 20, y: 60, width: 700, height: 400, viewportWidth: 1600, viewportHeight: 850, visible: true };
function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  const start = vi.fn(() => child), failure = vi.fn();
  const host = new MpvX11Host(failure, start as unknown as typeof spawn);
  return { child, start, failure, host };
}

describe('native video host boundary', () => {
  it('reads X11 IDs, never accepting root/negative/oversized handles', () => {
    const buffer = Buffer.alloc(8);
    if (endianness() === 'LE') buffer.writeBigUInt64LE(12345n); else buffer.writeBigUInt64BE(12345n);
    expect(nativeX11Id(buffer)).toBe(12345);
    for (const value of [Buffer.alloc(4), Buffer.alloc(1), Buffer.alloc(8, 255)]) expect(() => nativeX11Id(value)).toThrow();
  });
  it('validates geometry and hides regions extending outside the owner', () => {
    expect(validateViewport(bounds)).toEqual(bounds);
    expect(validateViewport({ ...bounds, x: -1 }).visible).toBe(false);
    expect(validateViewport({ ...bounds, width: 1700 }).visible).toBe(false);
    for (const value of [null, {}, { ...bounds, x: NaN }, { ...bounds, width: -1 }, { ...bounds, viewportWidth: 0 }, { ...bounds, visible: 'yes' }]) {
      expect(() => validateViewport(value)).toThrow('Invalid video area');
    }
    expect(validateViewport({ ...bounds, wid: 999 })).not.toHaveProperty('wid');
  });
  it('uses isolated system Python, waits for a child ID, sends geometry and cleans up', async () => {
    const f = fixture();
    const opening = f.host.open(12345);
    expect(f.start).toHaveBeenCalledWith('python3', ['-I', '-u', '-c', X11_HOST_SCRIPT, '12345'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    f.child.stdout.write('{"wid":'); f.child.stdout.write('54321}\n');
    expect(await opening).toBe(54321);
    f.host.update(bounds);
    expect(JSON.parse(f.child.stdin.read().toString())).toEqual(bounds);
    f.host.close(); f.host.close();
    expect(f.child.kill).toHaveBeenCalledOnce();
    expect(f.failure).not.toHaveBeenCalled();
  });
  it('preserves startup errors and handles a missing Python executable', async () => {
    const f = fixture();
    const opening = f.host.open(1).catch(error => error);
    f.child.emit('error', new Error('ENOENT'));
    expect((await opening).message).toContain('ENOENT');
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('rejects invalid IDs and timeouts; close cancels pending handshakes', async () => {
    vi.useFakeTimers();
    try {
      for (const action of ['invalid', 'timeout', 'close']) {
        const f = fixture(); const opening = f.host.open(1).catch(error => error);
        if (action === 'invalid') f.child.stdout.write('{"wid":0}\n');
        if (action === 'timeout') await vi.advanceTimersByTimeAsync(10001);
        if (action === 'close') f.host.close();
        expect(await opening).toBeInstanceOf(Error);
        expect(f.child.kill).toHaveBeenCalledOnce();
      }
    } finally { vi.useRealTimers(); }
  });
  it('reports helper failure after startup but ignores exits following normal close', async () => {
    const f = fixture(); const opening = f.host.open(1);
    f.child.stdout.write('{"wid":2}\n'); await opening;
    f.child.stderr.write('X11 error'); f.child.emit('exit', 1);
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('X11 error') }));
    f.child.emit('exit', 1); expect(f.failure).toHaveBeenCalledOnce();
  });
  it('compiles the packaged Python and binds real Xlib symbols without opening a display', () => {
    execFileSync('python3', ['-I', '-c', 'import sys; compile(sys.stdin.read(), "mpv-host", "exec")'], { input: X11_HOST_SCRIPT });
    if (process.platform === 'linux') execFileSync('python3', ['-I', '-c', X11_HOST_SCRIPT.split('d = open_display(None)')[0]]);
  });
  it('calculates 120% scaling and native menu offsets using the actual helper code', () => {
    const check = `import ast, sys
tree = ast.parse(sys.stdin.read())
scope = {}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'pixel_bounds'], type_ignores=[]), 'geometry', 'exec'), scope)
v = dict(x=10, y=50, width=400, height=225, viewportWidth=1600, viewportHeight=980)
assert scope['pixel_bounds'](v, 1920, 1200) == (12, 84, 480, 270)
assert scope['pixel_bounds'](v, 1600, 1000) == (10, 70, 400, 225)
`;
    execFileSync('python3', ['-I', '-c', check], { input: X11_HOST_SCRIPT });
  });
  it('maps only owned video children while visible, including late and recreated children', () => {
    const check = `import ast, ctypes as c, sys
tree = ast.parse(sys.stdin.read())
calls = []
def record(name):
    return lambda *args, **kwargs: calls.append((name, args))
def geometry(d, parent, root, xx, yy, width, height, border, depth):
    width._obj.value = 1920
    height._obj.value = 1080
    return 1
scope = dict(c=c, sys=sys, W=c.c_ulong, I=c.c_int, U=c.c_uint,
             d=1, parent=100, child=200, latest=None, geometry=geometry)
for name in ('hide', 'flush', 'report', 'move', 'map_children', 'show'):
    scope[name] = record(name)
names = ('pixel_bounds', 'apply', 'handle_window_event')
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[]), 'host', 'exec'), scope)
apply, event = scope['apply'], scope['handle_window_event']
apply()
assert calls == []
v = dict(x=19, y=258, width=1105, height=621, viewportWidth=1920, viewportHeight=1080, visible=True)
scope['latest'] = v
apply()
assert [name for name, _ in calls] == ['move', 'map_children', 'show', 'flush', 'report']
assert ('map_children', (1, 200)) in calls
for kind in (16, 18, 21):
    calls.clear()
    event(kind, 200, 300)
    assert ('map_children', (1, 200)) in calls
# Mapping/configuring our own windows must not cause an event feedback loop.
for kind, owner, window in ((19, 200, 300), (22, 200, 300), (18, 200, 200), (16, 999, 300), (17, 200, 300)):
    calls.clear()
    event(kind, owner, window)
    assert calls == []
# A dialog or clipped viewport must keep both host and video hidden.
for viewport in (dict(v, visible=False), dict(v, x=1900)):
    scope['latest'] = viewport
    for kind in (16, 18, 21, 22):
        calls.clear()
        event(kind, 100 if kind == 22 else 200, 100 if kind == 22 else 301)
        assert ('hide', (1, 200)) in calls
        assert not any(name in ('show', 'map_children') for name, _ in calls)
# Returning to visible must show the child even without another creation event.
scope['latest'] = v
calls.clear()
apply()
assert ('map_children', (1, 200)) in calls
for window in (100, 200):
    try:
        event(17, 100, window)
    except SystemExit as error:
        assert error.code == 0
    else:
        raise AssertionError('Destroyed owner must stop the helper')
`;
    execFileSync('python3', ['-I', '-c', check], { input: X11_HOST_SCRIPT });
  });
});
