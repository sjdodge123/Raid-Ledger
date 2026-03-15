import {
  fetchGemini,
  mapGeminiMessages,
  mapGeminiModel,
  mapGeminiChatResponse,
} from './google.helpers';

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

    it('passes API key as query parameter', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchGemini('my-api-key', '/v1beta/models');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('key=my-api-key'),
        expect.any(Object),
      );
    });

    it('appends key param correctly when path has no query', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchGemini('k', '/v1beta/models');
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('?key=k');
    });
  });

  describe('mapGeminiMessages — edge cases', () => {
    it('maps assistant role to model', () => {
      const result = mapGeminiMessages([
        { role: 'assistant', content: 'response' },
      ]);
      expect(result.contents[0].role).toBe('model');
    });
  });
});
