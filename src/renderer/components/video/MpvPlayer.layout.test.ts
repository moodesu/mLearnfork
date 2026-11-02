import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, type Rule } from 'postcss';

// CSS contract tests, not a substitute for a real browser's layout engine.
// Keep scrolling local to the study pane: moving the native surface behind
// the route header correctly trips the visibility guard and blanks the picture.
const sheet = parse(readFileSync('src/renderer/components/video/MpvPlayer.css', 'utf8'));
function declarations(selector: string, stacked = false) {
  const result: Record<string, string> = {};
  sheet.walkRules(selector, (rule: Rule) => {
    if ((rule.parent?.type === 'atrule') !== stacked) return;
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

describe('embedded player scroll containment', () => {
  it('bounds the desktop grid to its parent rather than making a tall sticky column', () => {
    expect(declarations('.mpv-player.mpv-embedded')).toMatchObject({
      height: '100%', 'min-height': '0', overflow: 'hidden', 'box-sizing': 'border-box',
    });
    expect(declarations('.mpv-embedded .mpv-layout')).toMatchObject({
      flex: '1', 'min-height': '0', 'grid-template-rows': 'minmax(0, 1fr)',
    });
    expect(declarations('.mpv-embedded .mpv-video-column').position).not.toBe('sticky');
    expect(declarations('.mpv-embedded .mpv-native-surface')).toMatchObject({
      flex: '0 1 auto', 'min-height': '0',
    });
  });
  it('scrolls study content and expanded controls without moving the video column', () => {
    for (const selector of ['.mpv-embedded .mpv-study-column', '.mpv-embedded .mpv-playback']) {
      expect(declarations(selector)).toMatchObject({ 'overflow-y': 'auto', 'overscroll-behavior': 'contain' });
    }
    expect(declarations('.mpv-embedded .mpv-playback')['max-height']).toBe('45%');
  });
  it('keeps all controls reachable when the narrow layout stacks vertically', () => {
    expect(declarations('.mpv-embedded .mpv-layout', true)).toMatchObject({ display: 'block', 'overflow-y': 'auto' });
    expect(declarations('.mpv-embedded .mpv-playback', true)).toMatchObject({ 'max-height': 'none', overflow: 'visible' });
    expect(declarations('.mpv-embedded .mpv-study-column', true).overflow).toBe('visible');
  });
});
