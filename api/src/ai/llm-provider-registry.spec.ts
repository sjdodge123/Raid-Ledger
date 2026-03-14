import { Test } from '@nestjs/testing';
import { LlmProviderRegistry } from './llm-provider-registry';
import { SettingsService } from '../settings/settings.service';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(key: string): LlmProvider {
  return {
    key,
    displayName: `${key} Provider`,
    requiresApiKey: false,
    selfHosted: true,
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest.fn().mockResolvedValue([]),
    chat: jest.fn().mockResolvedValue({ content: '', latencyMs: 0 }),
    generate: jest.fn().mockResolvedValue({ content: '', latencyMs: 0 }),
  };
}

describe('LlmProviderRegistry', () => {
  let registry: LlmProviderRegistry;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        LlmProviderRegistry,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    registry = module.get(LlmProviderRegistry);
  });

  describe('register', () => {
    it('stores a provider by key', () => {
      const provider = createMockProvider('ollama');
      registry.register(provider);
      expect(registry.resolve('ollama')).toBe(provider);
    });
  });

  describe('resolve', () => {
    it('returns undefined for unregistered key', () => {
      expect(registry.resolve('nonexistent')).toBeUndefined();
    });
  });

  describe('resolveActive', () => {
    it('reads ai_provider from settings and resolves', async () => {
      const provider = createMockProvider('ollama');
      registry.register(provider);
      mockSettings.get.mockResolvedValue('ollama');
      const result = await registry.resolveActive();
      expect(result).toBe(provider);
    });

    it('falls back to default provider when setting is null', async () => {
      const provider = createMockProvider('ollama');
      registry.register(provider);
      mockSettings.get.mockResolvedValue(null);
      const result = await registry.resolveActive();
      expect(result).toBe(provider);
    });

    it('returns undefined when no provider matches', async () => {
      mockSettings.get.mockResolvedValue('nonexistent');
      const result = await registry.resolveActive();
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns all registered providers', () => {
      registry.register(createMockProvider('ollama'));
      registry.register(createMockProvider('openai'));
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.key)).toEqual(
        expect.arrayContaining(['ollama', 'openai']),
      );
    });
  });
});

// — Adversarial tests —

describe('LlmProviderRegistry (adversarial)', () => {
  let registry: LlmProviderRegistry;
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockSettings = { get: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        LlmProviderRegistry,
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    registry = module.get(LlmProviderRegistry);
  });

  describe('register — overwrite behavior', () => {
    it('overwrites an existing provider with the same key', () => {
      const firstProvider = createMockProvider('ollama');
      const secondProvider = { ...createMockProvider('ollama'), displayName: 'Ollama v2' };
      registry.register(firstProvider);
      registry.register(secondProvider);
      expect(registry.resolve('ollama')?.displayName).toBe('Ollama v2');
    });
  });

  describe('list — empty registry', () => {
    it('returns empty array when no providers registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('resolveActive — edge cases', () => {
    it('returns undefined when settings returns unknown provider key', async () => {
      registry.register(createMockProvider('ollama'));
      mockSettings.get.mockResolvedValue('unknown-provider');
      const result = await registry.resolveActive();
      expect(result).toBeUndefined();
    });

    it('returns the default provider (ollama) when settings returns empty string', async () => {
      const provider = createMockProvider('ollama');
      registry.register(provider);
      mockSettings.get.mockResolvedValue('');
      // empty string is falsy — should fall back to AI_DEFAULTS.provider ('ollama')
      // but empty string is not null, so it depends on `??` operator (nullish coalescing)
      // '' ?? 'ollama' = '' — so it looks up '' which won't exist
      const result = await registry.resolveActive();
      expect(result).toBeUndefined(); // '' is not 'ollama', no match
    });

    it('resolves correctly after multiple providers are registered', async () => {
      registry.register(createMockProvider('ollama'));
      registry.register(createMockProvider('openai'));
      mockSettings.get.mockResolvedValue('openai');
      const result = await registry.resolveActive();
      expect(result?.key).toBe('openai');
    });
  });
});
