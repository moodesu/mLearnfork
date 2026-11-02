import { describe, expect, it, vi } from 'vitest';
const capture = vi.hoisted(() => vi.fn(async () => 'flashcard-image://correct-frame'));
vi.mock('../../services/flashcardImageCapture', () => ({ captureVideoFrameForFlashcard: capture }));
import { buildWordHoverFlashcardContent } from './wordHoverHelpers';

describe('saved subtitle card context', () => {
  it('uses the entry sentence and timestamp instead of the currently displayed line', async () => {
    const live = document.createElement('div'); live.className = 'subtitles'; live.textContent = 'unrelated current sentence'; document.body.append(live);
    const tokenize = vi.fn(async (text: string) => [{ word: text, actual_word: text, type: 'word' }]);
    try {
      const { content } = await buildWordHoverFlashcardContent({ token: { word: '王国', actual_word: '王国', type: 'word' },
        word: '王国', contextPhrase: '王国の話', useContextPhrase: true, nativeTime: 34.5,
        wordStatus: 'unknown', colourCodes: {}, tokenize });
      expect(tokenize).toHaveBeenCalledWith('王国の話');
      expect(content.example).toContain('王国の話');
      expect(content.example).not.toContain('unrelated');
      expect(content.imageUrl).toBe('flashcard-image://correct-frame');
      expect(capture).toHaveBeenLastCalledWith(expect.any(String), { nativeTime: 34.5 });
    } finally { live.remove(); }
  });
  it('keeps the original sentence if retokenization yields no words', async () => {
    const { content } = await buildWordHoverFlashcardContent({ token: { word: 'word', actual_word: 'word', type: 'word' },
      word: 'word', contextPhrase: 'saved sentence', useContextPhrase: true,
      wordStatus: 'unknown', colourCodes: {}, tokenize: async () => [] });
    expect(content.example).toBe('saved sentence');
  });
  it('reports a native capture failure instead of attaching a different frame', async () => {
    capture.mockRejectedValueOnce(new Error('frame unavailable'));
    await expect(buildWordHoverFlashcardContent({ token: { word: 'word', actual_word: 'word', type: 'word' },
      word: 'word', contextPhrase: 'saved', useContextPhrase: true, nativeTime: 30,
      wordStatus: 'unknown', colourCodes: {}, tokenize: async () => [] })).rejects.toThrow('frame unavailable');
  });
});
