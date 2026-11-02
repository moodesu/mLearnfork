import { spawn, type ChildProcess } from 'node:child_process';
import { endianness } from 'node:os';
import type { MpvViewport } from '../../shared/mpv';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.mpvX11Host');

export function nativeX11Id(handle: Buffer): number {
  if (handle.length !== 4 && handle.length !== 8) throw new Error('Unsupported native window handle');
  const id = handle.length === 8
    ? Number(endianness() === 'LE' ? handle.readBigUInt64LE() : handle.readBigUInt64BE())
    : endianness() === 'LE' ? handle.readUInt32LE() : handle.readUInt32BE();
  if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff) throw new Error('Invalid X11 window handle');
  return id;
}

export function validateViewport(value: unknown): MpvViewport {
  if (!value || typeof value !== 'object') throw new Error('Invalid video area');
  const v = value as MpvViewport;
  for (const key of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'] as const) {
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || Math.abs(v[key]) > 32768) throw new Error('Invalid video area');
  }
  if (v.width < 0 || v.height < 0 || v.viewportWidth <= 0 || v.viewportHeight <= 0 || typeof v.visible !== 'boolean') {
    throw new Error('Invalid video area');
  }
  return { x: v.x, y: v.y, width: v.width, height: v.height,
    viewportWidth: v.viewportWidth, viewportHeight: v.viewportHeight,
    visible: v.visible && v.x >= 0 && v.y >= 0 && v.width > 0 && v.height > 0 &&
      v.x + v.width <= v.viewportWidth + 1 && v.y + v.height <= v.viewportHeight + 1 };
}

/**
 * Small isolated Xlib host: no Python packages, shell, public socket or compiler.
 * The helper owns exactly one child of Electron's window. Exiting destroys it.
 * Kept as a constant so tsc packages it with the service (no runtime source paths).
 */
export const X11_HOST_SCRIPT = String.raw`
import ctypes as c, json, os, select, sys
x = c.CDLL('libX11.so.6')
D, W, I, U = c.c_void_p, c.c_ulong, c.c_int, c.c_uint
def bind(name, result, args):
    f = getattr(x, name); f.restype = result; f.argtypes = args; return f
open_display = bind('XOpenDisplay', D, [c.c_char_p])
create = bind('XCreateSimpleWindow', W, [D,W,I,I,U,U,U,W,W])
geometry = bind('XGetGeometry', I, [D,W,c.POINTER(W),c.POINTER(I),c.POINTER(I),c.POINTER(U),c.POINTER(U),c.POINTER(U),c.POINTER(U)])
move = bind('XMoveResizeWindow', I, [D,W,I,I,U,U])
show = bind('XMapRaised', I, [D,W])
map_children = bind('XMapSubwindows', I, [D,W])
hide = bind('XUnmapWindow', I, [D,W])
flush = bind('XFlush', I, [D])
sync = bind('XSync', I, [D,I])
select_input = bind('XSelectInput', I, [D,W,c.c_long])
connection = bind('XConnectionNumber', I, [D])
pending = bind('XPending', I, [D])
event = bind('XNextEvent', I, [D,D])
close = bind('XCloseDisplay', I, [D])
# Common prefix of XCreate/Reparent/Unmap/Destroy/ConfigureEvent.
class WindowEvent(c.Structure):
    _fields_ = [('type', I), ('serial', c.c_ulong), ('send_event', I),
                ('display', D), ('event', W), ('window', W)]
d = open_display(None)
if not d: raise RuntimeError('Cannot open X11 display; launch with npm run dev:embedded')
parent = int(sys.argv[1])
child = create(d, parent, 0, 0, 1, 1, 0, 0, 0)
select_input(d, parent, 1 << 17)
# Observe our host and its direct children, never redirect mpv's X requests.
select_input(d, child, (1 << 17) | (1 << 19))
sync(d, 0)
print(json.dumps({'wid': child}), flush=True)
latest = None
last_report = None
def report(reason, **details):
    global last_report
    value = json.dumps(dict(reason=reason, parent=parent, child=child, **details), sort_keys=True)
    if value != last_report:
        print(value, file=sys.stderr, flush=True)
        last_report = value
def pixel_bounds(v, parent_width, parent_height):
    scale = parent_width / v['viewportWidth']
    top = max(0, parent_height - round(v['viewportHeight'] * scale))
    return (round(v['x'] * scale), top + round(v['y'] * scale),
            max(1, round(v['width'] * scale)), max(1, round(v['height'] * scale)))
def apply():
    if latest is None: return
    v = latest
    if not v['visible']:
        hide(d, child); flush(d); report('renderer-hidden', viewport=v); return
    root, xx, yy, width, height, border, depth = W(), I(), I(), U(), U(), U(), U()
    if not geometry(d,parent,c.byref(root),c.byref(xx),c.byref(yy),c.byref(width),c.byref(height),c.byref(border),c.byref(depth)):
        raise RuntimeError('Parent window is unavailable')
    # X11 pixels / CSS viewport units handles both desktop scaling and page zoom.
    # The native client may include a menu bar above the renderer viewport.
    left, y, w, h = pixel_bounds(v, width.value, height.value)
    if left < 0 or y < 0 or left + w > width.value + 1 or y + h > height.value + 1:
        hide(d, child)
        reason = 'parent-clipped'
    else:
        move(d, child, left, y, w, h)
        # Mapping the host alone does not map an explicitly unmapped mpv child.
        # Restrict this to our private host and the visible, unclipped branch.
        map_children(d, child); show(d, child)
        reason = 'map-requested'
    flush(d)
    report(reason, parent_size=[width.value,height.value], bounds=[left,y,w,h])
def handle_window_event(kind, event_parent, window):
    if kind == 17: # DestroyNotify: mpv may replace its GL child without closing.
        if window in (parent, child): sys.exit(0)
        return
    if kind == 22 and window == parent: # Electron ConfigureNotify
        apply()
    elif event_parent == child and window != child and kind in (16, 18, 21):
        # Create/Unmap/ReparentNotify: a late or recreated video child needs a
        # map request even when the renderer's viewport has not changed.
        apply()
    # Ignore MapNotify and child ConfigureNotify generated by apply itself.
buffer = b''
try:
    while True:
        while pending(d):
            e = (c.c_long * 24)(); event(d, c.byref(e))
            details = c.cast(c.byref(e), c.POINTER(WindowEvent)).contents
            handle_window_event(details.type, details.event, details.window)
        readable, _, _ = select.select([0, connection(d)], [], [])
        if 0 in readable:
            chunk = os.read(0, 65536)
            if not chunk: break
            buffer += chunk
            if len(buffer) > 131072: raise RuntimeError('Video geometry message too large')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                latest = json.loads(line)
            apply()
finally:
    close(d)
`;

export class MpvX11Host {
  private child: ChildProcess | null = null;
  private rejectOpen: ((error: Error) => void) | null = null;
  private pendingViewport: MpvViewport | null = null;
  private backpressured = false;
  constructor(private readonly onFailure: (error: Error) => void, private readonly spawnProcess = spawn) {}

  open(parent: number): Promise<number> {
    if (this.child) return Promise.reject(new Error('Video host is already open'));
    if (!Number.isSafeInteger(parent) || parent <= 0 || parent > 0xffffffff) return Promise.reject(new Error('Invalid parent window'));
    const child = this.spawnProcess('python3', ['-I', '-u', '-c', X11_HOST_SCRIPT, String(parent)],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let errorText = '';
    let diagnosticBytes = 0;
    child.stderr?.on('data', (chunk: Buffer) => {
      errorText = (errorText + chunk.toString()).slice(-4000);
      if (this.child !== child || diagnosticBytes >= 32768) return;
      const text = chunk.toString().slice(0, 32768 - diagnosticBytes);
      diagnosticBytes += text.length;
      log.info('[EmbeddedVideo] host', text.trim());
    });
    const fail = (error: Error) => {
      if (this.child !== child) return;
      const opening = this.rejectOpen;
      opening?.(error);
      this.rejectOpen = null;
      this.close();
      if (!opening) this.onFailure(error);
    };
    child.on('error', error => fail(new Error(`Cannot start embedded video host: ${error.message}`)));
    child.on('exit', code => fail(new Error(`Embedded video host stopped (${code}): ${errorText}`)));
    child.stdin?.on('error', fail);
    child.stdin?.on('drain', () => {
      this.backpressured = false;
      if (this.pendingViewport) this.update(this.pendingViewport);
    });
    return new Promise((resolve, reject) => {
      // External process handshake timeout, not a guessed startup delay.
      const timeout = setTimeout(() => fail(new Error('Embedded video host startup timed out')), 10000);
      this.rejectOpen = error => { clearTimeout(timeout); reject(error); };
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        if (this.child !== child || !this.rejectOpen) return;
        buffer += chunk.toString();
        if (buffer.length > 4096) { fail(new Error('Invalid video host response')); return; }
        if (!buffer.includes('\n')) return;
        try {
          const { wid } = JSON.parse(buffer.split('\n')[0]);
          if (!Number.isSafeInteger(wid) || wid <= 0 || wid > 0xffffffff) throw new Error('Invalid child window');
          clearTimeout(timeout); this.rejectOpen = null; resolve(wid);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
    });
  }

  update(viewport: MpvViewport): void {
    this.pendingViewport = validateViewport(viewport);
    if (!this.child?.stdin || this.child.stdin.destroyed || this.backpressured) return;
    this.backpressured = !this.child.stdin.write(`${JSON.stringify(this.pendingViewport)}\n`);
    this.pendingViewport = null;
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.rejectOpen?.(new Error('Embedded video host closed'));
    this.rejectOpen = null; this.pendingViewport = null; this.backpressured = false;
    child?.stdin?.end();
    child?.kill();
  }
}
