import { describe, expect, it } from 'vitest';
import type { LLMToolCall } from '../../../shared/types';
import {
  hasCompleteExplainerGenerationOutput,
  hasCompleteStructuredExplainerOutput,
  toolCallsToParsedExplainer,
  hasExplainerGenerationOutput,
  isQuotaError,
  normalizeExplainerErrorMessage,
} from './explainerPopupState';

describe('explainerPopupState', () => {
  it('falls back to the provided error message when the provider error is blank', () => {
    expect(normalizeExplainerErrorMessage('   ', 'Fallback message')).toBe('Fallback message');
    expect(normalizeExplainerErrorMessage(undefined, 'Fallback message')).toBe('Fallback message');
  });

  it('preserves a non-empty provider error message', () => {
    expect(normalizeExplainerErrorMessage('Model refused the request', 'Fallback message')).toBe('Model refused the request');
  });

  it('extracts the error field from a JSON payload in the error string', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 429 {"error":"You have ran out of quota"}', 'Fallback')).toBe('You have ran out of quota');
  });

  it('extracts the message field when error is not present', () => {
    expect(normalizeExplainerErrorMessage('{"message":"Something went wrong"}', 'Fallback')).toBe('Something went wrong');
  });

  it('extracts the detail field when error and message are not present', () => {
    expect(normalizeExplainerErrorMessage('{"detail":"Not found"}', 'Fallback')).toBe('Not found');
  });

  it('falls back to the full string when JSON has no recognized fields', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 500 {"code":"unknown"}', 'Fallback')).toBe('Cloud LLM error: 500 {"code":"unknown"}');
  });

  it('falls back to the full string when JSON is malformed', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 500 {broken', 'Fallback')).toBe('Cloud LLM error: 500 {broken');
  });

  it('detects quota errors by keyword', () => {
    expect(isQuotaError('You have ran out of quota')).toBe(true);
    expect(isQuotaError('Rate limit exceeded')).toBe(true);
    expect(isQuotaError('Insufficient credits')).toBe(true);
    expect(isQuotaError('Usage limit reached')).toBe(true);
    expect(isQuotaError('Something else went wrong')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('treats an empty completion with no tool calls as a failed generation', () => {
    expect(hasExplainerGenerationOutput('', [])).toBe(false);
    expect(hasExplainerGenerationOutput('   ', [])).toBe(false);
  });

  it('treats incomplete tool calls as a failed generation', () => {
    expect(hasExplainerGenerationOutput('', [
      { id: 'tc-blank', name: '', arguments: {} },
      { id: 'tc-empty', name: 'show_translation', arguments: {} },
    ])).toBe(false);
  });

  it('treats structured tool output as valid even when the final text is empty', () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'tc-1',
        name: 'show_translation',
        arguments: {
          phrase: '殺すつもりはない',
          translation: 'I do not intend to kill.',
        },
      },
    ];

    expect(hasExplainerGenerationOutput('', toolCalls)).toBe(true);
  });

  it('treats word explanation and grammar tool output as valid without final text', () => {
    expect(hasExplainerGenerationOutput('', [
      {
        id: 'tc-explanation',
        name: 'show_explanation',
        arguments: {
          word: 'つもり',
          explanation: 'Intention or plan.',
          context_explanation: 'In this phrase, it marks intention.',
        },
      },
    ])).toBe(true);

    expect(hasExplainerGenerationOutput('', [
      {
        id: 'tc-grammar',
        name: 'show_grammar_points',
        arguments: {
          points: [
            {
              term: 'つもり',
              description: 'A noun-like expression for intention or plan.',
            },
          ],
        },
      },
    ])).toBe(true);
  });

  it('requires all structured word explanation cards for complete word output', () => {
    const translationOnly: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: {
          phrase: '殺すつもりはない',
          translation: 'I do not intend to kill.',
        },
      },
    ];
    const completeWordOutput: LLMToolCall[] = [{
      id: 'tc-explanation', name: 'show_explanation',
      arguments: { word: 'つもり', explanation: 'Intention or plan.', context_explanation: 'Here the speaker denies intending the action.' },
    }];
    expect(hasCompleteStructuredExplainerOutput([{ ...completeWordOutput[0], arguments: { explanation: 'Intention.' } }], 'word')).toBe(false);
    expect(hasCompleteStructuredExplainerOutput([{ ...completeWordOutput[0], arguments: { explanation: 'Intention.', context_explanation: ' ' } }], 'word')).toBe(false);

    expect(hasCompleteStructuredExplainerOutput(translationOnly, 'word')).toBe(false);
    expect(hasCompleteExplainerGenerationOutput('', translationOnly, 'word')).toBe(false);
    expect(hasCompleteStructuredExplainerOutput(completeWordOutput, 'word')).toBe(true);
    expect(hasCompleteExplainerGenerationOutput('', completeWordOutput, 'word')).toBe(true);
  });

  it('requires translation and grammar for complete phrase output', () => {
    const phraseOutput: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: { phrase: 'Bonjour le monde', translation: 'Hello world' },
      },
      {
        id: 'tc-grammar',
        name: 'show_grammar_points',
        arguments: { points: [{ term: 'Declarative phrase', description: 'A basic statement structure.' }] },
      },
    ];

    expect(hasCompleteStructuredExplainerOutput(phraseOutput.slice(0, 1), 'phrase')).toBe(false);
    expect(hasCompleteStructuredExplainerOutput(phraseOutput, 'phrase')).toBe(true);
  });

  it('treats raw fallback text as complete only when there are no structured sections', () => {
    const translationOnly: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: { phrase: 'Hi there', translation: 'Salut' },
      },
    ];

    expect(hasCompleteExplainerGenerationOutput('Plain explanation fallback.', [], 'word')).toBe(true);
    expect(hasCompleteExplainerGenerationOutput('show_explanation({"word":"hi"', translationOnly, 'word')).toBe(false);
    expect(hasExplainerGenerationOutput('show_explanation({"word":"hi"', translationOnly)).toBe(true);
  });
});


describe('word explanation cards', () => {
  it('renders general meaning before contextual meaning with separate labels', () => {
    const parsed = toolCallsToParsedExplainer([{
      id: 'explain', name: 'show_explanation',
      arguments: { word: '周辺', explanation: 'Surrounding area or vicinity.', context_explanation: 'Here it refers to events around them.' },
    }], '', (key) => key);
    expect(parsed.sections).toEqual([
      { type: 'explanation', title: 'mlearn.Explainer.Meaning', word: '周辺', content: 'Surrounding area or vicinity.' },
      { type: 'explanation', title: 'mlearn.Explainer.InThisSentence', word: '周辺', content: 'Here it refers to events around them.' },
    ]);
  });
});


describe('word readings', () => {
  it('keeps kanji readings separate from phonetic endings for ruby rendering', () => {
    const parts = [{ text: '認', reading: 'みと' }, { text: 'め', reading: '' }];
    const parsed = toolCallsToParsedExplainer([{ id: 'r', name: 'show_explanation', arguments: {
      word: '認め', reading_parts: parts, explanation: 'To acknowledge.', context_explanation: 'Here it means accept.',
    } }], '', (key) => key);
    expect(parsed.wordReadingParts).toEqual(parts);
  });

  it('ignores malformed readings or segments that change the selected word', () => {
    for (const parts of [[{ text: '別', reading: 'べつ' }], [{ text: '認め', reading: null }]]) {
      expect(toolCallsToParsedExplainer([{ id: 'r', name: 'show_explanation', arguments: {
        word: '認め', reading_parts: parts,
      } }], '', (key) => key).wordReadingParts).toBeUndefined();
    }
  });
});
