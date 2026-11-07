import {
  fetchGemini,
  mapGeminiMessages,
  mapGeminiModel,
  mapGeminiChatResponse,
} from './google.helpers';
import { LlmQuotaExhaustedError } from '../llm-errors';

describe('google.helpers', () => {
  describe('mapGeminiMessages', () => {
    it('converts user/assistant messages to Gemini format', () => {
      const result = mapGeminiMessages([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);
      expect(result.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
      ]);
      expect(result.systemInstruction).toBeUndefined();
    });

    it('extracts system messages to systemInstruction', () => {
      const result = mapGeminiMessages([
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hi' },
      ]);
      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'Be helpful.' }],
      });
      expect(result.contents).toHaveLength(1);
    });

    it('joins multiple system messages', () => {
      const result = mapGeminiMessages([
        { role: 'system', content: 'Rule 1.' },
        { role: 'system', content: 'Rule 2.' },
        { role: 'user', content: 'Hi' },
      ]);
      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'Rule 1.\nRule 2.' }],
      });
    });
  });

  describe('mapGeminiModel', () => {
    it('maps a raw Gemini model to LlmModelInfo', () => {
      const result = mapGeminiModel({
        name: 'models/gemini-2.0-flash',
        displayName: 'Gemini 2.0 Flash',
        supportedGenerationMethods: ['generateContent'],
      });
      expect(result).toEqual({
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'google',
      });
    });

    it('strips models/ prefix from name', () => {
      const result = mapGeminiModel({
        name: 'models/gemini-pro',
        displayName: 'Gemini Pro',
        supportedGenerationMethods: ['generateContent'],
      });
      expect(result.id).toBe('gemini-pro');
    });
  });

  describe('mapGeminiChatResponse', () => {
    it('maps a full response with usage', () => {
      const result = mapGeminiChatResponse(
        {
          candidates: [{ content: { parts: [{ text: 'Hello!' }] } }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
          },
        },
        200,
      );
      expect(result).toEqual({
        content: 'Hello!',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 200,
      });
    });

    it('handles missing candidates', () => {
      const result = mapGeminiChatResponse({}, 100);
      expect(result.content).toBe('');
      expect(result.usage).toBeUndefined();
    });

    it('handles empty candidates array', () => {
      const result = mapGeminiChatResponse({ candidates: [] }, 50);
      expect(result.content).toBe('');
    });
  });
});

describe('google.helpers (adversarial)', () => {
  describe('fetchGemini', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws on non-ok HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: jest.fn(),
        text: jest.fn().mockResolvedValue('error body'),
      });
      await expect(fetchGemini('test-key', '/v1beta/models')).rejects.toThrow(
        'Gemini /v1beta/models: HTTP 400',
      );
    });

    // ROK-2117: a `?key=` URL lands verbatim in Sentry's fetch breadcrumbs,
    // so the key travels only in the documented `x-goog-api-key` header.
    it('sends the API key in the x-goog-api-key header', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchGemini('my-api-key', '/v1beta/models');
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(options.headers['x-goog-api-key']).toBe('my-api-key');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(url).not.toContain('key=');
      expect(url).not.toContain('my-api-key');
    });

    it('leaves the request URL exactly the base plus the path', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchGemini('k', '/v1beta/models?pageSize=50');
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=50',
      );
    });

    it('POSTs the JSON body with the key header', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchGemini('k', '/v1beta/models/m:generateContent', { a: 1 });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(options.method).toBe('POST');
      expect(options.body).toBe('{"a":1}');
      expect(options.headers['x-goog-api-key']).toBe('k');
      expect(url).not.toContain('key=');
    });
  });

  // ROK-1376: quota/spend-cap failures must surface as a TYPED error that
  // preserves the provider HTTP status, so downstream callers (pre-gen
  // processor) can stop retrying calls that cannot succeed.
  describe('fetchGemini — quota classification (ROK-1376)', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    function mockFailure(status: number, body: string): void {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: jest.fn(),
        text: jest.fn().mockResolvedValue(body),
      });
    }

    it('throws LlmQuotaExhaustedError on HTTP 429 preserving the status', async () => {
      mockFailure(429, 'Your project has exceeded its monthly spending cap');
      const err = await fetchGemini('k', '/v1beta/models').catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LlmQuotaExhaustedError);
      expect((err as LlmQuotaExhaustedError).providerStatus).toBe(429);
      expect((err as Error).message).toContain('HTTP 429');
    });

    it('throws LlmQuotaExhaustedError on RESOURCE_EXHAUSTED body with non-429 status', async () => {
      mockFailure(500, '{"error":{"status":"RESOURCE_EXHAUSTED"}}');
      const err = await fetchGemini('k', '/v1beta/models').catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LlmQuotaExhaustedError);
      expect((err as LlmQuotaExhaustedError).providerStatus).toBe(500);
    });

    it('throws a plain Error (NOT quota) on generic provider failures', async () => {
      mockFailure(500, 'internal server error');
      const err = await fetchGemini('k', '/v1beta/models').catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(LlmQuotaExhaustedError);
    });
  });

  describe('mapGeminiMessages — edge cases', () => {
    it('maps assistant role to model', () => {
      const result = mapGeminiMessages([
        { role: 'assistant', content: 'response' },
      ]);
      expect(result.contents[0]?.role).toBe('model');
    });
  });
});
