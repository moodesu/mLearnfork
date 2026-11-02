// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LanguageData, LLMStreamChunk, LLMToolCall, Settings } from '../../shared/types';

// ============================================================================
// Mock setup
// ============================================================================

let streamCallback: ((chunk: LLMStreamChunk) => void) | null = null;
const mockCleanup = vi.fn();

const mockBridge = {
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockCleanup;
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
    llmCheckModel: vi.fn(),
    ollamaCheck: vi.fn(),
  },
};

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

const mockIsMobile = vi.fn(() => false);

vi.mock('../../shared/platform', () => ({
  isMobile: () => mockIsMobile(),
}));

const mockCloudAdapterStreamChat = vi.fn();
const mockCloudAdapterAbort = vi.fn();
const mockCloudAdapterCheckAvailability = vi.fn();

class MockCloudLLMAdapter {
  static lastInstance: MockCloudLLMAdapter | null = null;
  constructor(public baseUrl: string, public authToken: string) {
    MockCloudLLMAdapter.lastInstance = this;
  }
  streamChat = mockCloudAdapterStreamChat;
  abort = mockCloudAdapterAbort;
  checkAvailability = mockCloudAdapterCheckAvailability;
}

vi.mock('../../shared/backends/cloudLLMAdapter', () => ({
  CloudLLMAdapter: MockCloudLLMAdapter,
}));

vi.mock('../../shared/backends', () => ({
  resolveCloudApiUrl: vi.fn(() => 'https://api.example.com'),
}));

const mockEnsureCloudAccessToken = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => 'mock-cloud-token');
const mockGetCloudSessionSettings = vi.fn(() => null);
const mockIsCloudSessionError = vi.fn<(...args: unknown[]) => boolean>(() => false);
const mockWithCloudAuth = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (op?: unknown) => {
  if (typeof op !== 'function') {
    return undefined;
  }

  return op('mock-cloud-token');
});

class MockCloudSessionCancelledError extends Error {
  code = 'cloud_session_cancelled';
  constructor(message = 'Cloud sign-in canceled') {
    super(message);
    this.name = 'CloudSessionCancelledError';
  }
}

class MockCloudUnreachableError extends Error {
  code = 'cloud_unreachable';
  constructor(message = 'Cloud is unreachable') {
    super(message);
    this.name = 'CloudUnreachableError';
  }
}

vi.mock('./cloudSessionManager', () => ({
  CloudSessionCancelledError: MockCloudSessionCancelledError,
  CloudUnreachableError: MockCloudUnreachableError,
  ensureCloudAccessToken: (options?: unknown) => mockEnsureCloudAccessToken(options),
  getCloudSessionSettings: () => mockGetCloudSessionSettings(),
  isCloudSessionError: (error: unknown) => mockIsCloudSessionError(error),
  withCloudAuth: (op: unknown, options?: unknown) => mockWithCloudAuth(op, options),
}));

const mockBuiltinModelReady = vi.fn(() => true);

vi.mock('../context/llmModelSignals', () => ({
  builtinModelReady: () => mockBuiltinModelReady(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    llmProvider: 'builtin',
    llmEnabled: true,
    cloudAuthStatus: 'signed-in',
    ...overrides,
  } as Settings;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}

// ============================================================================
// Tests
// ============================================================================

describe('llmProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    streamCallback = null;
    mockCleanup.mockClear();
    mockBridge.llm.onLLMStreamChunk.mockClear();
    mockBridge.llm.llmStream.mockClear();
    mockBridge.llm.llmStreamAbort.mockClear();
    mockBridge.llm.llmCheckModel.mockClear();
    mockBridge.llm.ollamaCheck.mockClear();
    MockCloudLLMAdapter.lastInstance = null;
    mockCloudAdapterStreamChat.mockClear();
    mockCloudAdapterAbort.mockClear();
    mockCloudAdapterCheckAvailability.mockClear();
    mockIsMobile.mockReturnValue(false);
    mockEnsureCloudAccessToken.mockResolvedValue('mock-cloud-token');
    mockGetCloudSessionSettings.mockReturnValue(null);
    mockIsCloudSessionError.mockReturnValue(false);
    mockWithCloudAuth.mockImplementation(async (op?: unknown) => {
      if (typeof op !== 'function') {
        return undefined;
      }

      return op('mock-cloud-token');
    });

    mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockCleanup;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // streamChat
  // --------------------------------------------------------------------------

  describe('streamChat', () => {
    it('registers chunk listener and calls llmStream', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      expect(mockBridge.llm.onLLMStreamChunk).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledWith([], [], undefined, undefined);
    });

    it('accumulates content chunks and calls onChunk', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ content: 'Hello' });
      streamCallback!({ content: ' world' });

      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world', 'Hello world');
    });

    it('calls onDone with accumulated content and tool calls when chunk.done', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      const toolCall: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: { phrase: 'hello', translation: 'bonjour' } };

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ content: 'response' });
      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true });

      expect(onDone).toHaveBeenCalledOnce();
      expect(onDone).toHaveBeenCalledWith('response', [toolCall], expect.objectContaining({ totalTime: expect.any(Number) }));
    });

    it('logs completed LLM output in dev mode', async () => {
      const { streamChat } = await import('./llmProvider');
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const toolCall: LLMToolCall = { id: 'tc-dev', name: 'show_translation', arguments: { phrase: 'hello', translation: 'bonjour' } };

      streamChat(
        [{ role: 'user', content: 'hello' }],
        [],
        { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() },
        makeSettings({ devMode: true }),
      );

      streamCallback!({ content: 'response' });
      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true, evalCount: 10, evalDuration: 1_000_000_000 });

      const calls = consoleSpy.mock.calls.map((c) => c.join(' '));
      expect(calls.some((line) => line.includes('[LLMProvider] Prompt sent to LLM:'))).toBe(true);
      expect(calls.some((line) => line.includes('[LLMProvider] LLM stream completed:') && line.includes('"finalContent": "response"'))).toBe(true);
      expect(calls.some((line) => line.includes('[LLMProvider] LLM stream completed:') && line.includes('show_translation'))).toBe(true);
    });

    it('calls onToolCall for each tool call in the stream', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      const tc1: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: {} };
      const tc2: LLMToolCall = { id: 'tc2', name: 'show_explanation', arguments: {} };

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ toolCalls: [tc1, tc2] });
      streamCallback!({ done: true });

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall).toHaveBeenNthCalledWith(1, tc1);
      expect(onToolCall).toHaveBeenNthCalledWith(2, tc2);
    });

    it('calls onError and cleans up when error chunk arrives', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ error: 'Model crashed' });

      await Promise.resolve();
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith('Model crashed');
      expect(onDone).not.toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('cleans up the listener after done', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ done: true });

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('calculates tokensPerSecond from evalCount and evalDuration', async () => {
      const { streamChat } = await import('./llmProvider');
      const onDone = vi.fn();

      streamChat([], [], { onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall: vi.fn() });

      streamCallback!({ done: true, evalCount: 100, evalDuration: 2_000_000_000 });

      expect(onDone).toHaveBeenCalledWith(
        '',
        [],
        expect.objectContaining({ tokensPerSecond: 50 }),
      );
    });

    it('returns abort function that calls llmStreamAbort and cleanup', async () => {
      const { streamChat } = await import('./llmProvider');
      const handle = streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      handle.abort();

      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalledOnce();
      expect(mockCleanup).toHaveBeenCalledOnce();
    });

     it('wraps cloud streams in withCloudAuth with safe retry predicate', async () => {
       const { streamChat } = await import('./llmProvider');
       const onDone = vi.fn();
       const onError = vi.fn();

       streamChat(
         [{ role: 'user', content: 'hello' }],
         [],
        { onChunk: vi.fn(), onDone, onError, onToolCall: vi.fn() },
         makeSettings({ llmProvider: 'cloud' }),
       );

       await flushPromises();
       expect(mockWithCloudAuth).toHaveBeenCalledOnce();
       const options = mockWithCloudAuth.mock.calls[0]?.[1] as { alreadyEmittedOutput?: () => boolean } | undefined;
       expect(options?.alreadyEmittedOutput?.()).toBe(false);

       streamCallback!({ content: 'Recovered reply' });
       expect(options?.alreadyEmittedOutput?.()).toBe(true);
       streamCallback!({ done: true });

       expect(onDone).toHaveBeenCalledWith(
        'Recovered reply',
        [],
         expect.objectContaining({ totalTime: expect.any(Number) }),
       );
       expect(onError).not.toHaveBeenCalled();
     });

     it('passes typed cloud errors through onError', async () => {
       const { streamChat } = await import('./llmProvider');
       const onError = vi.fn();
       const cancelledError = new MockCloudSessionCancelledError();

       mockWithCloudAuth.mockRejectedValueOnce(cancelledError);

       streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError, onToolCall: vi.fn() }, makeSettings({ llmProvider: 'cloud' }));

       await flushPromises();

       expect(onError).toHaveBeenCalledWith(cancelledError);
     });
  });

  // --------------------------------------------------------------------------
  // abortStream
  // --------------------------------------------------------------------------

  describe('abortStream', () => {
    it('calls llmStreamAbort', async () => {
      const { abortStream } = await import('./llmProvider');
      abortStream();
      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalledOnce();
    });

    it('calls active cleanup if a stream is in progress', async () => {
      const { streamChat, abortStream } = await import('./llmProvider');

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      abortStream();

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('does not throw if no active stream', async () => {
      const { abortStream } = await import('./llmProvider');
      expect(() => abortStream()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // checkAvailability
  // --------------------------------------------------------------------------

  describe('checkAvailability', () => {
    it('returns auth_required when cloud has no access token', async () => {
      mockEnsureCloudAccessToken.mockResolvedValueOnce(null);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'cloud' }));
      expect(result).toEqual({ available: false, reason: 'auth_required' });
    });

    it('checks the selected built-in model even when the default model is missing', async () => {
      const builtinModel = 'gemma-4-E4B_q4_0-it.gguf';
      mockBridge.llm.llmCheckModel.mockImplementation(async (modelFile?: string) => ({
        downloaded: modelFile === builtinModel,
      }));
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin', builtinModel }));
      expect(mockBridge.llm.llmCheckModel).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmCheckModel).toHaveBeenCalledWith(builtinModel);
      expect(result).toEqual({ available: true });
    });

    it('returns model_not_downloaded when model is not downloaded', async () => {
      mockBridge.llm.llmCheckModel.mockResolvedValue({ downloaded: false });
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin' }));
      expect(result).toEqual({ available: false, reason: 'model_not_downloaded' });
    });

    it('returns model_check_failed when llmCheckModel throws', async () => {
      mockBridge.llm.llmCheckModel.mockRejectedValue(new Error('IPC error'));
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin' }));
      expect(result).toEqual({ available: false, reason: 'model_check_failed' });
    });

    it('checks Ollama via bridge.llm.ollamaCheck', async () => {
      mockBridge.llm.ollamaCheck.mockResolvedValue(true);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(mockBridge.llm.ollamaCheck).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true });
    });

    it('returns ollama_unreachable when ollamaCheck returns false', async () => {
      mockBridge.llm.ollamaCheck.mockResolvedValue(false);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(result).toEqual({ available: false, reason: 'ollama_unreachable' });
    });

    it('returns ollama_unreachable when ollamaCheck throws', async () => {
      mockBridge.llm.ollamaCheck.mockRejectedValue(new Error('timeout'));
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(result).toEqual({ available: false, reason: 'ollama_unreachable' });
    });

    it('uses CloudLLMAdapter for cloud provider', async () => {
      mockCloudAdapterCheckAvailability.mockResolvedValue(true);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'cloud', cloudAuthAccessToken: 'token123' }));
      expect(MockCloudLLMAdapter.lastInstance).not.toBeNull();
      expect(mockCloudAdapterCheckAvailability).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true });
    });

    it('returns cloud_unreachable when CloudLLMAdapter.checkAvailability returns false', async () => {
      mockCloudAdapterCheckAvailability.mockResolvedValue(false);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'cloud', cloudAuthAccessToken: 'token123' }));
      expect(result).toEqual({ available: false, reason: 'cloud_unreachable' });
    });

     it('returns auth_required when ensureCloudAccessToken returns null', async () => {
       mockEnsureCloudAccessToken.mockResolvedValue(null);
       const { checkAvailability } = await import('./llmProvider');
       const result = await checkAvailability(makeSettings({ llmProvider: 'cloud' }));
       expect(result).toEqual({ available: false, reason: 'auth_required' });
     });

     it('does not open modal for cloud diagnostic auth failures', async () => {
       mockEnsureCloudAccessToken.mockRejectedValue(new MockCloudSessionCancelledError());
       const { checkAvailability } = await import('./llmProvider');
       const result = await checkAvailability(makeSettings({ llmProvider: 'cloud' }));
       expect(result).toEqual({ available: false, reason: 'auth_required' });
     });

     it('returns cloud_unreachable for CloudUnreachableError during diagnostics', async () => {
       mockEnsureCloudAccessToken.mockRejectedValue(new MockCloudUnreachableError());
       const { checkAvailability } = await import('./llmProvider');
       const result = await checkAvailability(makeSettings({ llmProvider: 'cloud' }));
       expect(result).toEqual({ available: false, reason: 'cloud_unreachable' });
     });
   });

  // --------------------------------------------------------------------------
  // streamExplanation / explanation cache
  // --------------------------------------------------------------------------

  describe('streamExplanation', () => {
    it('calls streamChat with the correct system and user messages', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamExplanation('bonjour', 'Bonjour le monde', 'French', { onChunk, onDone, onError, onToolCall });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('French');
      expect(messages[0].content).toContain('Write both explanations in English');
      expect(messages[0].content).toContain('at most 25 words');
      expect(messages[0].content).toContain('at most 35 words');
      const tools = mockBridge.llm.llmStream.mock.calls[0][1];
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['show_explanation']);
      expect(tools[0].parameters.required).toEqual(['word', 'reading_parts', 'explanation', 'context_explanation']);
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('bonjour');
      expect(messages[1].content).toContain('Bonjour le monde');
    });

    it('uses installed language metadata names in explainer prompts', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const arabicData = {
        name: 'Arabic',
        name_translated: 'العربية',
        colour_codes: {},
        settings: { fixed: {} },
      } as LanguageData;

      streamExplanation('سلام', 'سلام دنیا', 'ar', {
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
        onToolCall: vi.fn(),
      }, { languageData: arabicData });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [
        Array<{ role: string; content: string }>,
        unknown,
      ];
      expect(messages[0].content).toContain('Arabic (العربية)');
      expect(messages[0].content).not.toContain('for ar.');
    });

    it('omits the word explanation tool in phrase mode', async () => {
      const { streamExplanation } = await import('./llmProvider');

      streamExplanation('', 'Bonjour le monde', 'French', {
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
        onToolCall: vi.fn(),
      }, { mode: 'phrase' });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages, tools] = mockBridge.llm.llmStream.mock.calls[0] as [
        Array<{ role: string; content: string }>,
        Array<{ name: string }>,
      ];

      expect(messages[0].content).toContain('Do not add a separate word-focused explanation');
      expect(messages[1].content).toContain('Only provide the translation and grammar cards');
      expect(tools.map((tool) => tool.name)).toEqual(['show_translation', 'show_grammar_points']);
    });

    it('parses plain-text fallback tool calls during streaming', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      streamCallback!({ content: 'show_explanation({"word":"周辺","explanation":"The surrounding area or vicinity.",' });
      expect(onToolCall).not.toHaveBeenCalled();
      streamCallback!({ content: '"context_explanation":"Here it means around them."})' });
      streamCallback!({ done: true });
      expect(onToolCall).toHaveBeenCalledOnce();
      expect(onDone.mock.calls[0][0]).toBe('');
      expect(onDone.mock.calls[0][1][0].arguments.context_explanation).toBe('Here it means around them.');
      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).not.toBeNull();
    });

    it('repairs a word response missing its contextual explanation with one tool', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      streamCallback!({ toolCalls: [{ id: 'partial', name: 'show_explanation', arguments: { word: '周辺', explanation: 'The surrounding area.' } }] });
      streamCallback!({ done: true });
      expect(onDone).not.toHaveBeenCalled();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);
      const [messages, tools] = mockBridge.llm.llmStream.mock.calls[1];
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['show_explanation']);
      expect(messages[0].content).toContain('English');
      expect(messages[1].content).toContain('context_explanation');
      streamCallback!({ toolCalls: [{ id: 'explain', name: 'show_explanation', arguments: { word: '周辺', explanation: 'The surrounding area or vicinity.', context_explanation: 'Here it means around them, where strange events happened.' } }] });
      streamCallback!({ done: true });
      expect(onToolCall).toHaveBeenCalledOnce();
      expect(onDone.mock.calls[0][1]).toHaveLength(1);
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).not.toBeNull();
    });

    it('uses installed language metadata names in explainer repair prompts', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const arabicData = {
        name: 'Arabic',
        name_translated: 'العربية',
        colour_codes: {},
        settings: { fixed: {} },
      } as LanguageData;

      streamExplanation('سلام', 'سلام دنیا', 'ar', {
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
        onToolCall: vi.fn(),
      }, { languageData: arabicData });

      streamCallback!({
        toolCalls: [{
          id: 'tc-translation',
          name: 'show_translation',
          arguments: {
            phrase: 'سلام دنیا',
            translation: 'Hello world',
          },
        }],
      });
      streamCallback!({ done: true });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);
      const [repairMessages] = mockBridge.llm.llmStream.mock.calls[1] as [
        Array<{ role: string; content: string }>,
        unknown,
      ];
      expect(repairMessages[0].content).toContain('Arabic (العربية)');
      expect(repairMessages[0].content).not.toContain('for ar.');
    });

    it('repairs incomplete phrase explanations by requesting the missing grammar tool only', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onDone = vi.fn();

      streamExplanation('', 'Bonjour le monde', 'French', {
        onChunk: vi.fn(),
        onDone,
        onError: vi.fn(),
        onToolCall: vi.fn(),
      }, { mode: 'phrase' });

      streamCallback!({
        toolCalls: [{
          id: 'tc-translation',
          name: 'show_translation',
          arguments: { phrase: 'Bonjour le monde', translation: 'Hello world' },
        }],
      });
      streamCallback!({ done: true });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);
      const [, repairTools] = mockBridge.llm.llmStream.mock.calls[1] as [unknown, Array<{ name: string }>];
      expect(repairTools.map((tool) => tool.name)).toEqual(['show_grammar_points']);

      streamCallback!({
        toolCalls: [{
          id: 'tc-grammar',
          name: 'show_grammar_points',
          arguments: { points: [{ term: 'Bonjour', description: 'A greeting used at the start of the phrase.' }] },
        }],
      });
      streamCallback!({ done: true });

      const [, finalToolCalls] = onDone.mock.calls[0] as [string, LLMToolCall[]];
      expect(finalToolCalls.map((toolCall) => toolCall.name)).toEqual(['show_translation', 'show_grammar_points']);
    });

    it('does not finish or cache when aborted during an explainer repair attempt', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      const handle = streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      streamCallback!({ toolCalls: [{ id: 'partial', name: 'show_explanation', arguments: { explanation: 'The surrounding area.' } }] });
      streamCallback!({ done: true });
      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);
      handle.abort();
      streamCallback!({ toolCalls: [{ id: 'explain', name: 'show_explanation', arguments: { word: '周辺', explanation: 'The surrounding area or vicinity.', context_explanation: 'Here it means around them, where strange events happened.' } }] });
      streamCallback!({ done: true });
      expect(onDone).not.toHaveBeenCalled();
      expect(onToolCall).not.toHaveBeenCalled();
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).toBeNull();
    });

    it('does not cache partial output when repair attempts are exhausted', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        streamCallback!({ toolCalls: [{ id: 'partial', name: 'show_explanation', arguments: { explanation: 'The surrounding area.' } }] });
        streamCallback!({ done: true });
      }
      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);
      expect(onDone).toHaveBeenCalledOnce();
      expect(onDone.mock.calls[0][1]).toEqual([]);
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).toBeNull();
    });

    it('parses tolerant fallback syntax for both word explanations', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      streamCallback!({ content: "show_explanation: {word: '周辺', explanation: 'The surrounding area.', context_explanation: 'Here it means around them.',}" });
      streamCallback!({ done: true });
      expect(onToolCall).toHaveBeenCalledOnce();
      expect(onDone.mock.calls[0][1][0].arguments).toEqual({ word: '周辺', explanation: 'The surrounding area.', context_explanation: 'Here it means around them.' });
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).not.toBeNull();
    });

    it('preserves apostrophes and JSON-like text inside tolerant fallback values', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      streamCallback!({ content: "show_explanation: {word: '周辺', explanation: 'The surrounding area.', context_explanation: 'It\'s the speaker\'s surroundings, not {term: value} JSON.'}" });
      streamCallback!({ done: true });
      expect(onDone.mock.calls[0][1][0].arguments.context_explanation).toBe("It's the speaker's surroundings, not {term: value} JSON.");
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')).not.toBeNull();
    });

    it('ignores incomplete structured tool-call fragments', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();

      streamExplanation('bonjour', 'Bonjour le monde', 'French', {
        onChunk: vi.fn(),
        onDone,
        onError: vi.fn(),
        onToolCall,
      });

      streamCallback!({
        toolCalls: [
          { id: 'tc-1', name: 'show_translation', arguments: {} },
          { id: 'tc-2', name: '', arguments: {} },
        ],
      });
      streamCallback!({ done: true });

      expect(onToolCall).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledWith('', [], expect.objectContaining({ totalTime: expect.any(Number) }));
    });

    it('caches the result after onDone and returns it on second call', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();
      streamExplanation('周辺', '彼らの周辺で奇妙なことが起きた。', 'Japanese', {
        onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall,
      });
      const toolCall = { id: 'explain', name: 'show_explanation', arguments: { word: '周辺', explanation: 'The surrounding area or vicinity.', context_explanation: 'Here it means around them, where strange events happened.' } };
      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true });
      expect(getCachedExplanation('周辺', '彼らの周辺で奇妙なことが起きた。')?.toolCalls).toEqual([toolCall]);
      expect(getCachedExplanation('周辺', '彼らの周辺で別のことが起きた。')).toBeNull();
      expect(onDone).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });

    it('keeps sentences with the same first 100 characters separate in the cache', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const prefix = 'Long shared context '.repeat(10);
      streamExplanation('area', prefix + 'near the house', 'English', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });
      streamCallback!({ toolCalls: [{ id: 'explain', name: 'show_explanation', arguments: { word: '周辺', explanation: 'The surrounding area or vicinity.', context_explanation: 'Here it means around them, where strange events happened.' } }] });
      streamCallback!({ done: true });
      expect(getCachedExplanation('area', prefix + 'near the house')).not.toBeNull();
      expect(getCachedExplanation('area', prefix + 'near the office')).toBeNull();
    });

    it('does not cache translation-only structured word explanations', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const toolCall: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: { phrase: 'hi', translation: 'salut' } };

      streamExplanation('hi', 'Hi there', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true });

      expect(getCachedExplanation('hi', 'Hi there')).toBeNull();
    });

    it('does not cache incomplete structured output with leftover fallback text', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');

      streamExplanation('hi', 'Hi there', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      streamCallback!({ toolCalls: [{ id: 'partial', name: 'show_explanation', arguments: { explanation: 'A casual greeting.' } }] });
      streamCallback!({ content: '\nshow_explanation({"word":"hi","explanation":"A casual greeting."' });
      streamCallback!({ done: true });

      expect(getCachedExplanation('hi', 'Hi there')).toBeNull();
    });

    it('returns null from getCachedExplanation when entry is missing', async () => {
      const { getCachedExplanation } = await import('./llmProvider');
      expect(getCachedExplanation('unknown', 'no context')).toBeNull();
    });

    it('expires a cache entry older than 24 hours', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');

      const onDone = vi.fn();
      streamExplanation('word', 'context', 'French', { onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall: vi.fn() });
      streamCallback!({ done: true });

      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      const cached = getCachedExplanation('word', 'context');
      expect(cached).toBeNull();
      vi.useRealTimers();
    });

    it('second streamExplanation call with same params hits bridge again (no short-circuit in streamExplanation)', async () => {
      const { streamExplanation } = await import('./llmProvider');

      streamExplanation('salut', 'Salut ami', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });
      streamCallback!({ done: true });

      mockBridge.llm.llmStream.mockClear();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockCleanup;
      });

      streamExplanation('salut', 'Salut ami', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });
  });

  // --------------------------------------------------------------------------
  // Mobile path via CloudLLMAdapter
  // --------------------------------------------------------------------------

  describe('mobile path (isMobile = true)', () => {
    beforeEach(() => {
      mockIsMobile.mockReturnValue(true);
    });

    it('uses CloudLLMAdapter when isMobile returns true and settings has tethered backendMode', async () => {
      const { streamChat } = await import('./llmProvider');

      mockCloudAdapterStreamChat.mockImplementation(() => {});

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'token123',
      } as Partial<Settings>);

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      expect(MockCloudLLMAdapter.lastInstance).not.toBeNull();
      expect(MockCloudLLMAdapter.lastInstance!.baseUrl).toBe('http://desktop.local:7753');
      expect(mockCloudAdapterStreamChat).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    });

    it('calls onError when no LLM endpoint configured for mobile', async () => {
      const { streamChat } = await import('./llmProvider');
      const onError = vi.fn();

      const settings = makeSettings({
        backendMode: 'local',
      } as Partial<Settings>);

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError, onToolCall: vi.fn() }, settings);

      expect(onError).toHaveBeenCalledWith('No LLM endpoint configured for mobile');
    });

    it('falls back to IPC bridge when isMobile returns true but settings is undefined', async () => {
      const { streamChat } = await import('./llmProvider');

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });

    it('returns abort that calls adapter.abort', async () => {
      const { streamChat } = await import('./llmProvider');
      mockCloudAdapterStreamChat.mockImplementation(() => {});

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'tok',
      } as Partial<Settings>);

      const handle = streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      handle.abort();

      expect(mockCloudAdapterAbort).toHaveBeenCalledOnce();
    });

    it('streams content via CloudLLMAdapter onChunk callback', async () => {
      const { streamChat } = await import('./llmProvider');

      let adapterOnChunkCb: ((chunk: LLMStreamChunk) => void) | null = null;
      let adapterOnDoneCb: (() => void) | null = null;

      mockCloudAdapterStreamChat.mockImplementation(
        (_msgs: unknown, _tools: unknown, cbs: { onChunk: (c: LLMStreamChunk) => void; onDone: () => void; onError: (e: string) => void }) => {
          adapterOnChunkCb = cbs.onChunk;
          adapterOnDoneCb = cbs.onDone;
        }
      );

      const onChunk = vi.fn();
      const onDone = vi.fn();

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'tok',
      } as Partial<Settings>);

      streamChat([], [], { onChunk, onDone, onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      adapterOnChunkCb!({ content: 'Hello' });
      adapterOnChunkCb!({ content: ' world' });
      adapterOnDoneCb!();

      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world', 'Hello world');
      expect(onDone).toHaveBeenCalledWith('Hello world', [], expect.objectContaining({ totalTime: expect.any(Number) }));
    });
  });

  // --------------------------------------------------------------------------
  // isLLMReady
  // --------------------------------------------------------------------------

  describe('isLLMReady', () => {
    it('returns false when llmEnabled is false for builtin', async () => {
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmEnabled: false, llmProvider: 'builtin' }))).toBe(false);
    });

    it('returns true for cloud when signed in, even if llmEnabled is false', async () => {
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmEnabled: false, llmProvider: 'cloud', cloudAuthStatus: 'signed-in' }))).toBe(true);
    });

    it('returns true for cloud when signed in', async () => {
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmProvider: 'cloud', cloudAuthStatus: 'signed-in' }))).toBe(true);
    });

    it('returns false for cloud when signed out', async () => {
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmProvider: 'cloud', cloudAuthStatus: 'signed-out' }))).toBe(false);
    });

    it('returns true for ollama regardless of model state', async () => {
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmProvider: 'ollama' }))).toBe(true);
    });

    it('returns true for builtin when model is downloaded', async () => {
      mockBuiltinModelReady.mockReturnValue(true);
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmProvider: 'builtin' }))).toBe(true);
    });

    it('returns false for builtin when model is not downloaded', async () => {
      mockBuiltinModelReady.mockReturnValue(false);
      const { isLLMReady } = await import('./llmProvider');
      expect(isLLMReady(makeSettings({ llmProvider: 'builtin' }))).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // requiresSetup
  // --------------------------------------------------------------------------

  describe('requiresSetup', () => {
    it('returns false when the provider is ready', async () => {
      const { requiresSetup } = await import('./llmProvider');
      expect(requiresSetup(makeSettings({ llmProvider: 'ollama' }))).toBe(false);
    });

    it('returns true when the provider is not ready', async () => {
      const { requiresSetup } = await import('./llmProvider');
      expect(requiresSetup(makeSettings({ llmProvider: 'cloud', cloudAuthStatus: 'signed-out' }))).toBe(true);
    });
  });
});


describe('manual AI', () => {
  it('is ready without a downloaded model or local component', async () => {
    const { isLLMReady, checkAvailability, streamChat } = await import('./llmProvider');
    const settings = { llmProvider: 'manual', llmEnabled: false } as Settings;
    expect(isLLMReady(settings)).toBe(true);
    expect(await checkAvailability(settings)).toEqual({ available: true });
    const onError = vi.fn();
    mockBridge.llm.llmStream.mockClear();
    streamChat([], [], { onChunk: vi.fn(), onToolCall: vi.fn(), onDone: vi.fn(), onError }, settings);
    expect(onError).toHaveBeenCalledOnce();
    expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
  });

  it('includes the exact word, full context, English cards and reading format', async () => {
    const { buildManualExplanationPrompt } = await import('./llmProvider');
    const prompt = buildManualExplanationPrompt('認め', '不思議とか神秘とかを認めない。', 'Japanese');
    expect(prompt).toContain('認め');
    expect(prompt).toContain('不思議とか神秘とかを認めない。');
    expect(prompt).toContain('Write both explanations in English');
    expect(prompt).toContain('reading_parts');
    expect(prompt).toContain('return ONLY one JSON object');
  });

  it('accepts JSON with optional code fences and preserves readings', async () => {
    const { parseManualExplanationResponse } = await import('./llmProvider');
    const response = { word: '認め', reading_parts: [{ text: '認', reading: 'みと' }, { text: 'め', reading: '' }], explanation: 'To acknowledge.', context_explanation: 'Here it means accept.' };
    const result = parseManualExplanationResponse('```json\n' + JSON.stringify(response) + '\n```', '認め');
    expect(result?.[0].arguments).toEqual(response);
  });

  it('rejects malformed or incomplete answers without hiding the existing explanation', async () => {
    const { parseManualExplanationResponse } = await import('./llmProvider');
    for (const input of ['plain prose', '{}', 'null', '[]', '{"explanation":"Meaning only"}', '{"explanation":"Meaning","context_explanation":" "}']) {
      expect(parseManualExplanationResponse(input, '認め')).toBeNull();
    }
  });

  it('supports phrase mode using translation and grammar cards', async () => {
    const { buildManualExplanationPrompt, parseManualExplanationResponse } = await import('./llmProvider');
    expect(buildManualExplanationPrompt('', 'Hello there', 'English', { mode: 'phrase' })).toContain('"points"');
    const calls = parseManualExplanationResponse(JSON.stringify({ translation: 'Hello there', points: [{ term: 'Hello', description: 'A greeting.' }] }), '', 'phrase');
    expect(calls?.map((call) => call.name)).toEqual(['show_translation', 'show_grammar_points']);
  });
});
