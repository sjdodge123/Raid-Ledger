import { getApiKeySettingKey, buildProviderInfo } from './ai-providers.helpers';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    key: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    selfHosted: false,
    isAvailable: jest.fn(),
    listModels: jest.fn(),
    chat: jest.fn(),
    generate: jest.fn(),
    ...overrides,
  };
}

describe('ai-providers.helpers', () => {
  describe('getApiKeySettingKey', () => {
    it('returns the correct setting key for openai', () => {
      expect(getApiKeySettingKey('openai')).toBe('ai_openai_api_key');
    });

    it('returns the correct setting key for claude', () => {
      expect(getApiKeySettingKey('claude')).toBe('ai_claude_api_key');
    });

    it('returns the correct setting key for google', () => {
      expect(getApiKeySettingKey('google')).toBe('ai_google_api_key');
    });

    it('returns undefined for unknown providers', () => {
      expect(getApiKeySettingKey('unknown')).toBeUndefined();
    });

    it('returns undefined for ollama (self-hosted)', () => {
      expect(getApiKeySettingKey('ollama')).toBeUndefined();
    });
  });

  describe('buildProviderInfo', () => {
    it('builds a provider info DTO with all fields', () => {
      const provider = createMockProvider();
      const result = buildProviderInfo(provider, true, true, true);
      expect(result).toEqual({
        key: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        selfHosted: false,
        configured: true,
        available: true,
        active: true,
      });
    });

    it('sets configured/available/active to false', () => {
      const provider = createMockProvider();
      const result = buildProviderInfo(provider, false, false, false);
      expect(result.configured).toBe(false);
      expect(result.available).toBe(false);
      expect(result.active).toBe(false);
    });
  });
});
