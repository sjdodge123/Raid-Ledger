import { Test } from '@nestjs/testing';
import { GoogleProvider } from './google.provider';
import { SettingsService } from '../../settings/settings.service';
import * as helpers from './google.helpers';

jest.mock('./google.helpers', () => ({
  ...jest.requireActual('./google.helpers'),
  fetchGemini: jest.fn(),
}));

const mockFetch = helpers.fetchGemini as jest.Mock;

describe('GoogleProvider', () => {
  let provider: GoogleProvider;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn().mockResolvedValue('test-api-key') };
    const module = await Test.createTestingModule({
      providers: [
        GoogleProvider,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    provider = module.get(GoogleProvider);
    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('test-api-key');
  });

  it('has correct static properties', () => {
    expect(provider.key).toBe('google');
    expect(provider.displayName).toBe('Google (Gemini)');
    expect(provider.requiresApiKey).toBe(true);
    expect(provider.selfHosted).toBe(false);
  });

  describe('isAvailable', () => {
    it('returns true when API key is set and API responds', async () => {
      mockFetch.mockResolvedValue({ models: [] });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when no API key is configured', async () => {
      mockSettings.get.mockResolvedValue(null);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false when API call fails', async () => {
      mockFetch.mockRejectedValue(new Error('HTTP 403'));
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns filtered models that support generateContent', async () => {
      mockFetch.mockResolvedValue({
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding-001',
            displayName: 'Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      });
      const models = await provider.listModels();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('gemini-2.0-flash');
    });

    it('throws when no API key is configured', async () => {
      mockSettings.get.mockResolvedValue(null);
      await expect(provider.listModels()).rejects.toThrow(
        'Google API key not configured',
      );
    });
  });

  describe('chat', () => {
    it('sends a generateContent request and returns mapped response', async () => {
      mockFetch.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Hello!' }] } }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
        },
      });
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.content).toBe('Hello!');
      expect(result).toHaveProperty('latencyMs');
    });
  });

  describe('generate', () => {
    it('sends prompt as a user message', async () => {
      mockFetch.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Generated' }] } }],
      });
      const result = await provider.generate({ prompt: 'Write something' });
      expect(result.content).toBe('Generated');
    });
  });
});
