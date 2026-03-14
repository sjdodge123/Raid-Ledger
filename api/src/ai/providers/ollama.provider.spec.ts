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
