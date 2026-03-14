import { Test } from '@nestjs/testing';
import { OllamaProvider } from './ollama.provider';
import { SettingsService } from '../../settings/settings.service';
import * as helpers from './ollama.helpers';

jest.mock('./ollama.helpers', () => ({
  ...jest.requireActual('./ollama.helpers'),
  fetchOllama: jest.fn(),
}));

const mockFetchOllama = helpers.fetchOllama as jest.Mock;

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue(null) };
    const module = await Test.createTestingModule({
      providers: [
        OllamaProvider,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    provider = module.get(OllamaProvider);
    jest.clearAllMocks();
  });

  it('has correct static properties', () => {
    expect(provider.key).toBe('ollama');
    expect(provider.displayName).toBe('Ollama (Local)');
    expect(provider.requiresApiKey).toBe(false);
    expect(provider.selfHosted).toBe(true);
  });

  describe('isAvailable', () => {
    it('returns true when Ollama responds', async () => {
      mockFetchOllama.mockResolvedValue({ models: [] });
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when Ollama is unreachable', async () => {
      mockFetchOllama.mockRejectedValue(new Error('Connection refused'));
      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns mapped models from Ollama tags endpoint', async () => {
      mockFetchOllama.mockResolvedValue({
        models: [
          { name: 'llama3.2:3b', model: 'llama3.2:3b' },
          { name: 'mistral:latest', model: 'mistral:latest' },
        ],
      });
      const models = await provider.listModels();
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'llama3.2:3b',
        provider: 'ollama',
      });
    });
  });

  describe('chat', () => {
    it('sends a chat request and returns mapped response', async () => {
      mockFetchOllama.mockResolvedValue({
        message: { content: 'Hello!' },
        prompt_eval_count: 10,
        eval_count: 5,
      });
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.content).toBe('Hello!');
      expect(result).toHaveProperty('latencyMs');
      expect(typeof result.latencyMs).toBe('number');
    });
  });

  describe('generate', () => {
    it('sends a generate request and returns mapped response', async () => {
      mockFetchOllama.mockResolvedValue({
        response: 'Generated text',
        prompt_eval_count: 15,
        eval_count: 10,
      });
      const result = await provider.generate({
        prompt: 'Write something',
      });
      expect(result.content).toBe('Generated text');
      expect(typeof result.latencyMs).toBe('number');
    });
  });
});

// — Adversarial tests —

describe('OllamaProvider (adversarial)', () => {
  let provider: OllamaProvider;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue(null) };
    const module = await Test.createTestingModule({
      providers: [
        OllamaProvider,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    provider = module.get(OllamaProvider);
    jest.clearAllMocks();
  });

  describe('getBaseUrl — custom URL from settings', () => {
    it('uses the URL from settings when configured', async () => {
      mockSettings.get.mockResolvedValue('http://my-ollama:11434');
      mockFetchOllama.mockResolvedValue({ models: [] });
      await provider.listModels();
      expect(mockFetchOllama).toHaveBeenCalledWith(
        'http://my-ollama:11434',
        expect.any(String),
      );
    });

    it('falls back to default URL when settings returns null', async () => {
      mockSettings.get.mockResolvedValue(null);
      mockFetchOllama.mockResolvedValue({ models: [] });
      await provider.listModels();
      expect(mockFetchOllama).toHaveBeenCalledWith(
        'http://ollama:11434',
        expect.any(String),
      );
    });
  });

  describe('isAvailable — error paths', () => {
    it('returns false on network timeout error', async () => {
      mockFetchOllama.mockRejectedValue(new Error('AbortError: signal aborted'));
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false on non-ok HTTP response (thrown by fetchOllama)', async () => {
      mockFetchOllama.mockRejectedValue(new Error('Ollama /api/tags: HTTP 503'));
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('listModels — edge cases', () => {
    it('returns empty array when models field is missing', async () => {
      mockFetchOllama.mockResolvedValue({});
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });

    it('returns empty array when models is empty', async () => {
      mockFetchOllama.mockResolvedValue({ models: [] });
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });

    it('maps model capabilities from details.family', async () => {
      mockFetchOllama.mockResolvedValue({
        models: [
          {
            name: 'phi3:mini',
            model: 'phi3:mini',
            details: { family: 'phi3' },
          },
        ],
      });
      const [model] = await provider.listModels();
      expect(model.capabilities).toEqual(['phi3']);
    });

    it('propagates fetchOllama errors on listModels', async () => {
      mockFetchOllama.mockRejectedValue(new Error('HTTP 500'));
      await expect(provider.listModels()).rejects.toThrow('HTTP 500');
    });
  });

  describe('chat — edge cases', () => {
    it('uses options.model when specified', async () => {
      mockFetchOllama.mockResolvedValue({
        message: { content: 'ok' },
        prompt_eval_count: 5,
        eval_count: 3,
      });
      await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'mistral:latest',
      });
      const body = JSON.parse(
        (mockFetchOllama.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.model).toBe('mistral:latest');
    });

    it('uses default model when options.model is not set', async () => {
      mockFetchOllama.mockResolvedValue({
        message: { content: 'ok' },
      });
      await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
      const body = JSON.parse(
        (mockFetchOllama.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.model).toBe('llama3.2:3b');
    });

    it('returns empty content when message.content is missing', async () => {
      mockFetchOllama.mockResolvedValue({ message: {} });
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.content).toBe('');
    });

    it('propagates fetchOllama errors on chat', async () => {
      mockFetchOllama.mockRejectedValue(new Error('Ollama /api/chat: HTTP 404'));
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('HTTP 404');
    });

    it('sets stream: false in the request body', async () => {
      mockFetchOllama.mockResolvedValue({ message: { content: 'ok' } });
      await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
      const body = JSON.parse(
        (mockFetchOllama.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.stream).toBe(false);
    });
  });

  describe('generate — edge cases', () => {
    it('returns empty content when response field is missing', async () => {
      mockFetchOllama.mockResolvedValue({});
      const result = await provider.generate({ prompt: 'test' });
      expect(result.content).toBe('');
    });

    it('propagates fetchOllama errors on generate', async () => {
      mockFetchOllama.mockRejectedValue(new Error('Ollama /api/generate: HTTP 500'));
      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(
        'HTTP 500',
      );
    });

    it('sets stream: false in the generate request body', async () => {
      mockFetchOllama.mockResolvedValue({ response: 'ok' });
      await provider.generate({ prompt: 'test' });
      const body = JSON.parse(
        (mockFetchOllama.mock.calls[0][2] as { body: string }).body,
      );
      expect(body.stream).toBe(false);
    });
  });
});
