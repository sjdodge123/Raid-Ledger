import {
  fetchOpenAi,
  mapOpenAiModel,
  mapOpenAiChatResponse,
  OPENAI_CHAT_MODELS,
} from './openai.helpers';

describe('openai.helpers', () => {
  describe('mapOpenAiModel', () => {
    it('maps a raw model to LlmModelInfo', () => {
      const result = mapOpenAiModel({ id: 'gpt-4o', object: 'model' });
      expect(result).toEqual({
        id: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
      });
    });
  });

  describe('mapOpenAiChatResponse', () => {
    it('maps a full response with usage', () => {
      const result = mapOpenAiChatResponse(
        {
          choices: [{ message: { content: 'Hello!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
        200,
      );
      expect(result).toEqual({
        content: 'Hello!',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 200,
      });
    });

    it('handles missing choices gracefully', () => {
      const result = mapOpenAiChatResponse({}, 100);
      expect(result.content).toBe('');
      expect(result.usage).toBeUndefined();
    });

    it('handles missing usage gracefully', () => {
      const result = mapOpenAiChatResponse(
        { choices: [{ message: { content: 'Hi' } }] },
        50,
      );
      expect(result.usage).toBeUndefined();
    });
  });

  describe('OPENAI_CHAT_MODELS', () => {
    it('contains known model IDs', () => {
      expect(OPENAI_CHAT_MODELS).toContain('gpt-4o');
      expect(OPENAI_CHAT_MODELS).toContain('gpt-4o-mini');
      expect(OPENAI_CHAT_MODELS).toContain('o3-mini');
    });
  });
});

describe('openai.helpers (adversarial)', () => {
  describe('fetchOpenAi', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws on non-ok HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: jest.fn(),
        text: jest.fn().mockResolvedValue('error body'),
      });
      await expect(fetchOpenAi('sk-test', '/v1/models')).rejects.toThrow(
        'OpenAI /v1/models: HTTP 401',
      );
    });

    it('returns parsed JSON on ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });
      const result = await fetchOpenAi('sk-test', '/v1/models');
      expect(result).toEqual({ data: [] });
    });

    it('sends Authorization header with Bearer token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchOpenAi('sk-mykey', '/v1/models');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-mykey',
          }),
        }),
      );
    });

    it('passes request body for POST requests', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchOpenAi('sk-test', '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o' }),
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4o' }),
        }),
      );
    });

    it('aborts after the configured timeout', async () => {
      global.fetch = jest.fn().mockImplementation(
        (_url: string, opts: RequestInit) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              );
            });
          }),
      );
      await expect(
        fetchOpenAi('sk-test', '/v1/models', { timeoutMs: 50 }),
      ).rejects.toThrow(/abort/i);
    });

    it('sends an AbortSignal to fetch for timeout control', async () => {
      let capturedSignal: AbortSignal | undefined;
      global.fetch = jest
        .fn()
        .mockImplementation((_url: string, opts: RequestInit) => {
          capturedSignal = opts.signal as AbortSignal;
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({}),
          });
        });
      await fetchOpenAi('sk-test', '/v1/models');
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('uses 5s default timeout when timeoutMs is not provided', async () => {
      let capturedSignal: AbortSignal | undefined;
      global.fetch = jest
        .fn()
        .mockImplementation((_url: string, opts: RequestInit) => {
          capturedSignal = opts.signal as AbortSignal;
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({}),
          });
        });
      await fetchOpenAi('sk-test', '/v1/models');
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);
    });
  });

  describe('mapOpenAiChatResponse — edge cases', () => {
    it('returns empty content when choices has empty message', () => {
      const result = mapOpenAiChatResponse({ choices: [{ message: {} }] }, 50);
      expect(result.content).toBe('');
    });

    it('returns empty content when choices array is empty', () => {
      const result = mapOpenAiChatResponse({ choices: [] }, 50);
      expect(result.content).toBe('');
    });
  });
});
