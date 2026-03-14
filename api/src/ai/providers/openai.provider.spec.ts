import { Test } from '@nestjs/testing';
import { OpenAiProvider } from './openai.provider';
import { SettingsService } from '../../settings/settings.service';
import * as helpers from './openai.helpers';

jest.mock('./openai.helpers', () => ({
  ...jest.requireActual('./openai.helpers'),
  fetchOpenAi: jest.fn(),
}));

const mockFetch = helpers.fetchOpenAi as jest.Mock;

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue('sk-test-key') };
    const module = await Test.createTestingModule({
      providers: [
        OpenAiProvider,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    provider = module.get(OpenAiProvider);
    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('sk-test-key');
  });

  it('has correct static properties', () => {
    expect(provider.key).toBe('openai');
    expect(provider.displayName).toBe('OpenAI');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.selfHosted).toBe(false);
  });

  describe('isAvailable', () => {
    it('returns true when API key is set and API responds', async () => {
      mockFetch.mockResolvedValue({ data: [{ id: 'gpt-4o' }] });
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
    it('returns filtered chat models', async () => {
      mockFetch.mockResolvedValue({
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
          { id: 'gpt-4o-mini', object: 'model' },
        ],
      });
      const models = await provider.listModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gpt-4o');
      expect(models[1].id).toBe('gpt-4o-mini');
    });

    it('throws when no API key is configured', async () => {
      mockSettings.get.mockResolvedValue(null);
      await expect(provider.listModels()).rejects.toThrow(
        'OpenAI API key not configured',
      );
    });
  });

  describe('chat', () => {
    it('sends a chat request and returns mapped response', async () => {
      mockFetch.mockResolvedValue({
        choices: [{ message: { content: 'Hello!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.content).toBe('Hello!');
      expect(result).toHaveProperty('latencyMs');
    });

    it('uses specified model in the request body', async () => {
      mockFetch.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4-turbo',
      });
      const body = JSON.parse(
        (mockFetch.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.model).toBe('gpt-4-turbo');
    });
  });

  describe('generate', () => {
    it('sends prompt as a user message', async () => {
      mockFetch.mockResolvedValue({
        choices: [{ message: { content: 'Generated' } }],
      });
      const result = await provider.generate({ prompt: 'Test prompt' });
      expect(result.content).toBe('Generated');
      const body = JSON.parse(
        (mockFetch.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.messages).toEqual([{ role: 'user', content: 'Test prompt' }]);
    });
  });
});
