import {
  fetchOllama,
  mapOllamaModel,
  mapOllamaChatResponse,
  mapOllamaGenerateResponse,
} from './ollama.helpers';

describe('ollama.helpers', () => {
  describe('mapOllamaModel', () => {
    it('maps a raw model to LlmModelInfo', () => {
      const result = mapOllamaModel({
        name: 'llama3.2:3b',
        model: 'llama3.2:3b',
        details: {
          parameter_size: '3B',
          quantization_level: 'Q4_K_M',
          family: 'llama',
        },
      });
      expect(result).toEqual({
        id: 'llama3.2:3b',
        name: 'llama3.2:3b',
        provider: 'ollama',
        capabilities: ['llama'],
      });
    });

    it('handles missing details gracefully', () => {
      const result = mapOllamaModel({
        name: 'custom',
        model: 'custom',
      });
      expect(result).toEqual({
        id: 'custom',
        name: 'custom',
        provider: 'ollama',
        capabilities: undefined,
      });
    });
  });

  describe('mapOllamaChatResponse', () => {
    it('maps a raw chat response with usage', () => {
      const result = mapOllamaChatResponse(
        {
          message: { content: 'Hello' },
          prompt_eval_count: 10,
          eval_count: 5,
        },
        150,
      );
      expect(result).toEqual({
        content: 'Hello',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 150,
      });
    });

    it('handles missing content and usage', () => {
      const result = mapOllamaChatResponse({}, 100);
      expect(result).toEqual({
        content: '',
        usage: undefined,
        latencyMs: 100,
      });
    });
  });

  describe('mapOllamaGenerateResponse', () => {
    it('maps a raw generate response', () => {
      const result = mapOllamaGenerateResponse(
        {
          response: 'Generated text',
          prompt_eval_count: 20,
          eval_count: 15,
        },
        200,
      );
      expect(result).toEqual({
        content: 'Generated text',
        usage: { promptTokens: 20, completionTokens: 15 },
        latencyMs: 200,
      });
    });

    it('handles missing response field', () => {
      const result = mapOllamaGenerateResponse({}, 50);
      expect(result).toEqual({
        content: '',
        usage: undefined,
        latencyMs: 50,
      });
    });
  });
});

// — Adversarial tests —

describe('ollama.helpers (adversarial)', () => {
  describe('fetchOllama', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
      jest.useRealTimers();
    });

    it('throws on non-ok HTTP response with path and status in message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: jest.fn(),
      });
      await expect(
        fetchOllama('http://ollama:11434', '/api/tags'),
      ).rejects.toThrow('Ollama /api/tags: HTTP 503');
    });

    it('returns parsed JSON on ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ models: [] }),
      });
      const result = await fetchOllama('http://ollama:11434', '/api/tags');
      expect(result).toEqual({ models: [] });
    });

    it('sends the AbortSignal to fetch so it can be aborted', async () => {
      let capturedSignal: AbortSignal | undefined;
      global.fetch = jest.fn().mockImplementation(
        (_url: string, opts: RequestInit) => {
          capturedSignal = opts.signal as AbortSignal;
          return new Promise(() => {}); // never resolves
        },
      );
      // Start the call (don't await — it never resolves)
      void fetchOllama('http://ollama:11434', '/api/tags', { timeoutMs: 100 });
      // Give the event loop a tick for the call to begin
      await new Promise((r) => setImmediate(r));
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('accepts custom timeoutMs without throwing on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ models: ['fast'] }),
      });
      const result = await fetchOllama('http://ollama:11434', '/api/tags', {
        timeoutMs: 10_000,
      });
      expect(result).toEqual({ models: ['fast'] });
    });

    it('constructs the full URL by concatenating baseUrl and path', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchOllama('http://custom-host:9000', '/api/generate');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://custom-host:9000/api/generate',
        expect.any(Object),
      );
    });
  });

  describe('mapOllamaModel — adversarial', () => {
    it('uses undefined capabilities when details exists but family is absent', () => {
      const result = mapOllamaModel({
        name: 'model',
        model: 'model',
        details: { parameter_size: '7B' }, // no family
      });
      expect(result.capabilities).toBeUndefined();
    });

    it('sets provider to "ollama" always', () => {
      const result = mapOllamaModel({ name: 'x', model: 'x' });
      expect(result.provider).toBe('ollama');
    });
  });

  describe('mapOllamaChatResponse — adversarial', () => {
    it('includes usage when only prompt_eval_count is set (eval_count missing)', () => {
      const result = mapOllamaChatResponse(
        { message: { content: 'hi' }, prompt_eval_count: 5 },
        100,
      );
      expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 0 });
    });

    it('includes usage when only eval_count is set (prompt_eval_count missing)', () => {
      const result = mapOllamaChatResponse(
        { message: { content: 'hi' }, eval_count: 10 },
        100,
      );
      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 10 });
    });

    it('usage is undefined when both eval counts are absent', () => {
      const result = mapOllamaChatResponse({ message: { content: 'hi' } }, 50);
      expect(result.usage).toBeUndefined();
    });
  });

  describe('mapOllamaGenerateResponse — adversarial', () => {
    it('includes usage when only prompt_eval_count is set', () => {
      const result = mapOllamaGenerateResponse(
        { response: 'ok', prompt_eval_count: 7 },
        80,
      );
      expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 0 });
    });

    it('includes usage when only eval_count is set', () => {
      const result = mapOllamaGenerateResponse(
        { response: 'ok', eval_count: 12 },
        80,
      );
      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 12 });
    });
  });
});
