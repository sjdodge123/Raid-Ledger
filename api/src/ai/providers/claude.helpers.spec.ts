import {
  fetchClaude,
  extractSystemPrompt,
  mapClaudeChatResponse,
  CLAUDE_MODELS,
} from './claude.helpers';

describe('claude.helpers', () => {
  describe('extractSystemPrompt', () => {
    it('extracts system messages and returns them separately', () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        { role: 'user' as const, content: 'Hello' },
      ];
      const result = extractSystemPrompt(messages);
      expect(result.systemPrompt).toBe('You are helpful.');
      expect(result.conversationMessages).toEqual([
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('joins multiple system messages with newline', () => {
      const messages = [
        { role: 'system' as const, content: 'Rule 1.' },
        { role: 'system' as const, content: 'Rule 2.' },
        { role: 'user' as const, content: 'Hi' },
      ];
      const result = extractSystemPrompt(messages);
      expect(result.systemPrompt).toBe('Rule 1.\nRule 2.');
    });

    it('returns undefined systemPrompt when no system messages', () => {
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const result = extractSystemPrompt(messages);
      expect(result.systemPrompt).toBeUndefined();
      expect(result.conversationMessages).toHaveLength(1);
    });
  });

  describe('mapClaudeChatResponse', () => {
    it('maps a full response with usage', () => {
      const result = mapClaudeChatResponse(
        {
          content: [{ type: 'text', text: 'Hello!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        200,
      );
      expect(result).toEqual({
        content: 'Hello!',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 200,
      });
    });

    it('handles missing content blocks', () => {
      const result = mapClaudeChatResponse({}, 100);
      expect(result.content).toBe('');
      expect(result.usage).toBeUndefined();
    });

    it('handles empty content array', () => {
      const result = mapClaudeChatResponse({ content: [] }, 50);
      expect(result.content).toBe('');
    });
  });

  describe('CLAUDE_MODELS', () => {
    it('contains known model entries', () => {
      const ids = CLAUDE_MODELS.map((m) => m.id);
      expect(ids).toContain('claude-sonnet-4-20250514');
      expect(ids).toContain('claude-haiku-4-5-20251001');
    });
  });
});

describe('claude.helpers (adversarial)', () => {
  describe('fetchClaude', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws on non-ok HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: jest.fn(),
      });
      await expect(
        fetchClaude('sk-ant-test', '/v1/messages', {}),
      ).rejects.toThrow('Anthropic /v1/messages: HTTP 403');
    });

    it('returns parsed JSON on ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ content: [] }),
      });
      const result = await fetchClaude('sk-ant-test', '/v1/messages', {});
      expect(result).toEqual({ content: [] });
    });

    it('sends required Anthropic headers', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });
      await fetchClaude('sk-ant-key', '/v1/messages', {});
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-key',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('extractSystemPrompt — edge cases', () => {
    it('preserves assistant messages in conversation', () => {
      const messages = [
        { role: 'system' as const, content: 'Be concise.' },
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello' },
      ];
      const result = extractSystemPrompt(messages);
      expect(result.conversationMessages).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
    });
  });
});
