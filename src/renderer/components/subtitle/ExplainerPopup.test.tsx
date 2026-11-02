import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const mocks = vi.hoisted(() => ({ copy: vi.fn(), stream: vi.fn(), access: vi.fn() }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ files: { writeToClipboard: mocks.copy } }) }));
vi.mock('../../context', () => ({
  useSettings: () => ({ settings: { llmProvider: 'manual', language: 'ja' } }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({ currentLangData: () => undefined }),
  useLowPowerGate: () => ({ requestAccess: mocks.access }),
}));
vi.mock('../../services/llmProvider', () => ({
  buildManualExplanationPrompt: (word: string, context: string) => `${word}: ${context}`,
  parseManualExplanationResponse: (value: string, word: string) => value === 'valid answer' ? [{
    id: 'manual', name: 'show_explanation', arguments: { word, explanation: 'Meaning.', context_explanation: 'In context.' },
  }] : null,
  streamExplanation: mocks.stream,
  getCachedExplanation: vi.fn(),
  requiresSetup: vi.fn(() => false),
}));
vi.mock('../../services/cloudSessionManager', () => ({ CloudSessionCancelledError: class extends Error {}, CloudUnreachableError: class extends Error {} }));
vi.mock('../common', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  IconBtn: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Textarea: (props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Spinner: () => <span />,
  DraggablePopup: (props: { children: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock('./ExplainerCards', () => ({ ExplainerCards: (props: { data: unknown }) => <div data-cards>{JSON.stringify(props.data)}</div> }));
import { ExplainerPopup } from './ExplainerPopup';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });
describe('manual Explain popup', () => {
  it('copies the prompt and displays a pasted answer without requesting local AI', () => {
    dispose = render(() => <ExplainerPopup isOpen onClose={() => {}} word="認め" contextPhrase="認めない。" />, document.body);
    const button = (text: string) => Array.from(document.querySelectorAll('button')).find((el) => el.textContent === text)!;
    button('mlearn.AI.Manual.CopyPrompt').click();
    expect(mocks.copy).toHaveBeenCalledWith('認め: 認めない。');
    const input = document.querySelector('textarea[aria-label="mlearn.AI.Manual.Response"]') as HTMLTextAreaElement;
    input.value = 'bad answer'; input.dispatchEvent(new Event('input', { bubbles: true }));
    button('mlearn.AI.Manual.ShowResponse').click();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    input.value = 'valid answer'; input.dispatchEvent(new Event('input', { bubbles: true }));
    button('mlearn.AI.Manual.ShowResponse').click();
    expect(document.querySelector('[data-cards]')?.textContent).toContain('In context.');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });
});
