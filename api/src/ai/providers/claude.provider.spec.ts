import { Test } from '@nestjs/testing';
import { ClaudeProvider } from './claude.provider';
import { SettingsService } from '../../settings/settings.service';
import * as helpers from './claude.helpers';

jest.mock('./claude.helpers', () => ({
  ...jest.requireActual('./claude.helpers'),
  fetchClaude: jest.fn(),
}));

const mockFetch = helpers.fetchClaude as jest.Mock;

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue('sk-ant-test') };
    const module = await Test.createTestingModule({
      providers: [
        ClaudeProvider,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    provider = module.get(ClaudeProvider);
    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('sk-ant-test');
  });

  it('has correct static properties', () => {
    expect(provider.key).toBe('claude');
    expect(provider.displayName).toBe('Claude (Anthropic)');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.selfHosted).toBe(false);
  });

  describe('isAvailable', () => {
    it('returns true when API key is set and API responds', async () => {
      mockFetch.mockResolvedValue({ content: [] });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when no API key is configured', async () => {
      mockSettings.get.mockResolvedValue(null);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false when API call fails', async () => {
      mockFetch.mockRejectedValue(new Error('HTTP 401'));
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns hardcoded Claude models', async () => {
      const models = await provider.listModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('claude-sonnet-4-20250514');
      expect(models[1].id).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('chat', () => {
    it('sends a chat request with system prompt extracted', async () => {
      mockFetch.mockResolvedValue({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 8, output_tokens: 3 },
      });
      const result = await provider.chat({
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      });
      expect(result.content).toBe('Hi there!');
      const body = mockFetch.mock.calls[0][2];
      expect(body.system).toBe('Be helpful.');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('throws when no API key is configured', async () => {
      mockSettings.get.mockResolvedValue(null);
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('Claude API key not configured');
    });
  });

  describe('generate', () => {
    it('sends prompt as a user message', async () => {
      mockFetch.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated' }],
      });
      const result = await provider.generate({ prompt: 'Write something' });
      expect(result.content).toBe('Generated');
    });
  });
});
