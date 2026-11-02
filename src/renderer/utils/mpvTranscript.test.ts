import { describe, expect, it } from 'vitest';
import { activeTranscriptIndex, delayedCue, parseMpvTranscript, sentenceFrameTime, transcriptTime } from './mpvTranscript';

describe('mpv transcript', () => {
  const cues = [{ start: 10, end: 20, text: 'long' }, { start: 12, end: 14, text: 'short' }];
  it('parses CRLF, multiline subtitles, markup and unsorted cues', () => {
    expect(parseMpvTranscript('2\r\n00:00:12,000 --> 00:00:14,000\r\n<i>次</i>\r\n行\r\n\r\n1\r\n00:00:10,000 --> 00:00:20,000\r\n{\\b1}前')).toEqual([
      { start: 10, end: 20, text: '前' }, { start: 12, end: 14, text: '次\n行' },
    ]);
    expect(parseMpvTranscript('1\n00:00:20,000 --> 00:00:10,000\ninvalid')).toEqual([]);
  });
  it('handles overlaps, gaps, and positive/negative delay without applying it twice', () => {
    expect(activeTranscriptIndex(cues, 13, 0)).toBe(1);
    expect(activeTranscriptIndex(cues, 15, 0)).toBe(0);
    expect(activeTranscriptIndex(cues, 20, 0)).toBe(-1);
    expect(activeTranscriptIndex(cues, 93, 80)).toBe(1);
    expect(activeTranscriptIndex(cues, 8, -5)).toBe(1);
    expect(delayedCue(cues[0], 80)).toEqual({ start: 90, end: 100, text: 'long' });
  });
  it('chooses a frame inside the sentence and rejects unavailable timestamps', () => {
    expect(sentenceFrameTime(173, 175)).toBe(174);
    expect(sentenceFrameTime(-1, 0.5)).toBe(0);
    expect(sentenceFrameTime(undefined, 4)).toBeUndefined();
    expect(sentenceFrameTime(4, 3)).toBeUndefined();
    expect(sentenceFrameTime(NaN, 4)).toBeUndefined();
    expect(transcriptTime(173.9)).toBe('2:53');
  });
});
