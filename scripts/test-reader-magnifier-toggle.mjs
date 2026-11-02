// Run with Node 22.13+; exercises the actual ReaderRoute keyboard handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const route = await readFile(new URL('../src/renderer/windows/main/routes/ReaderRoute.tsx', import.meta.url), 'utf8');
const block = route.slice(route.indexOf('  // Keyboard navigation and magnifier hotkey'), route.indexOf('  // Save current page progress and first-page thumbnail'));
function createReader() {
  let active = false;
  let hideCount = 0;
  const listeners = new Map();
  const cleanups = [];
  const events = (prefix) => ({
    addEventListener: (name, callback) => listeners.set(prefix + name, callback),
    removeEventListener: (name) => listeners.delete(prefix + name),
  });
  class Element {
    constructor(editable = false, input = false) { this.isContentEditable = editable; this.input = input; }
    closest() { return this.input ? this : null; }
  }
  const settings = { readerMagnifierHotkey: 'z' };
  vm.runInNewContext(stripTypeScriptTypes(block), {
    settings, HTMLElement: Element,
    magnifierActive: () => active, setMagnifierActive: (value) => { active = value; },
    getGlobalHoverManager: () => ({ forceHide: () => { hideCount++; } }),
    parseKeybind: (value) => { const parts = value.split('+'); return { key: parts.pop(), modifiers: parts }; },
    onMount: (fn) => fn(), onCleanup: (fn) => cleanups.push(fn),
    document: events('doc:'), window: events('win:'), prevPage() {}, nextPage() {}, runOcr() {},
  });
  return {
    settings, Element, active: () => active, hides: () => hideCount,
    key(key, options = {}) {
      let prevented = false;
      listeners.get('doc:keydown')?.({ key, target: new Element(), repeat: false, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault() { prevented = true; }, ...options });
      return prevented;
    },
    release() { listeners.get('doc:keyup')?.({ key: 'z' }); },
    blur() { listeners.get('win:blur')?.(); },
    cleanup() { cleanups.forEach((fn) => fn()); }, listeners,
  };
}
test('press toggles on, release leaves it on, next press toggles off', () => {
  const r = createReader();
  assert.equal(r.key('z'), true); assert.equal(r.active(), true);
  r.release(); assert.equal(r.active(), true);
  r.key('z', { repeat: true }); assert.equal(r.active(), true);
  r.key('z'); assert.equal(r.active(), false); assert.equal(r.hides(), 1);
});
test('Escape and window blur dismiss the magnifier', () => {
  const r = createReader(); r.key('z'); r.key('Escape'); assert.equal(r.active(), false);
  r.key('z'); r.blur(); assert.equal(r.active(), false);
});
test('ignores typing in form fields, editable regions, and IME composition', () => {
  const r = createReader();
  for (const target of [new r.Element(true), new r.Element(false, true)]) {
    r.key('z', { target }); assert.equal(r.active(), false);
  }
  r.key('z', { isComposing: true }); assert.equal(r.active(), false);
});
test('respects changed hotkeys and modifier combinations', () => {
  const r = createReader(); r.settings.readerMagnifierHotkey = 'shift+c';
  r.key('z'); assert.equal(r.active(), false);
  r.key('c'); assert.equal(r.active(), false);
  r.key('C', { shiftKey: true }); assert.equal(r.active(), true);
});
test('removes event listeners when leaving the reader', () => {
  const r = createReader(); r.cleanup(); assert.equal(r.listeners.size, 0);
});
