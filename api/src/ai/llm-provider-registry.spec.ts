import { Test } from '@nestjs/testing';
import { LlmProviderRegistry } from './llm-provider-registry';
import { SettingsService } from '../settings/settings.service';
import type { LlmProvider } from './llm-provider.interface';

interface MockProviderShape {
  selfHosted?: boolean;
  requiresApiKey?: boolean;
}

function createMockProvider(
  key: string,
  shape: MockProviderShape = {},
): LlmProvider {
  // Default shape mirrors the legacy ollama provider (self-hosted, keyless)
  // so existing tests keep passing without explicitly opting in.
  return {
    key,
    displayName: `${key} Provider`,
    requiresApiKey: shape.requiresApiKey ?? false,
    selfHosted: shape.selfHosted ?? true,
    defaultModel: 'mock-model',
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest.fn().mockResolvedValue([]),
    chat: jest.fn().mockResolvedValue({ content: '', latencyMs: 0 }),
    generate: jest.fn().mockResolvedValue({ content: '', latencyMs: 0 }),
  };
}

function createCloudProvider(key: string): LlmProvider {
  return createMockProvider(key, { selfHosted: false, requiresApiKey: true });
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
      expect(result).toEqual({ provider, source: 'setting' });
    });

    it('auto-picks the first cloud provider with an API key when setting is null', async () => {
      // ROK-1114: removed AI_DEFAULTS.provider hardcoded fallback. With
      // setting unset, the registry walks registered cloud providers and
      // picks the first one whose ai_<key>_api_key is configured.
      const claude = createCloudProvider('claude');
      registry.register(claude);
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'ai_provider') return null;
        if (key === 'ai_claude_api_key') return 'sk-test-claude';
        return null;
      });
      const result = await registry.resolveActive();
      expect(result).toEqual({ provider: claude, source: 'auto' });
    });

    it('returns undefined when settings names a non-existent provider AND no auto-pick is available', async () => {
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
      const secondProvider = {
        ...createMockProvider('ollama'),
        displayName: 'Ollama v2',
      };
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
    it('falls through to auto-pick when settings names an unknown provider key', async () => {
      // ROK-1114: an unknown explicit provider key no longer short-circuits
      // — we still try auto-pick. With no cloud providers registered, the
      // result is undefined.
      registry.register(createMockProvider('ollama'));
      mockSettings.get.mockResolvedValue('unknown-provider');
      const result = await registry.resolveActive();
      expect(result).toBeUndefined();
    });

    it('returns undefined when settings returns empty string and no API key is configured', async () => {
      // Empty string is falsy → auto-pick path. With only a self-hosted
      // provider registered (no requiresApiKey), auto-pick skips it.
      const provider = createMockProvider('ollama');
      registry.register(provider);
      mockSettings.get.mockResolvedValue('');
      const result = await registry.resolveActive();
      expect(result).toBeUndefined();
    });

    it('resolves correctly after multiple providers are registered', async () => {
      registry.register(createMockProvider('ollama'));
      registry.register(createMockProvider('openai'));
      mockSettings.get.mockResolvedValue('openai');
      const result = await registry.resolveActive();
      expect(result?.provider.key).toBe('openai');
      expect(result?.source).toBe('setting');
    });
  });
});

// ── ROK-1114: resolveActive auto-picks when ai_provider is unset ───
//
// Original prod outage: AI suggestions never loaded because the registry
// fell back to a hard-coded provider (`AI_DEFAULTS.provider`) that was not
// actually configured with credentials. Rework drops the hardcoded default
// and instead walks registered cloud providers, picking the first one
// whose API key is set. `source: 'auto'` surfaces that path in logs so
// operators can tell at-a-glance whether the explicit setting was honoured.

describe('LlmProviderRegistry.resolveActive — source reporting (ROK-1114)', () => {
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

  it("returns source: 'setting' when ai_provider is set in app_settings", async () => {
    const provider = createCloudProvider('openai');
    registry.register(provider);
    mockSettings.get.mockResolvedValue('openai');

    const result = await registry.resolveActive();

    expect(result).toEqual({ provider, source: 'setting' });
  });

  it("auto-picks Claude with source: 'auto' when only Claude has an API key", async () => {
    const claude = createCloudProvider('claude');
    const google = createCloudProvider('google');
    registry.register(claude);
    registry.register(google);
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'ai_provider') return null;
      if (key === 'ai_claude_api_key') return 'sk-ant-test';
      return null;
    });

    const result = await registry.resolveActive();

    expect(result).toEqual({ provider: claude, source: 'auto' });
  });

  it("auto-picks Google with source: 'auto' when only Google has an API key", async () => {
    const claude = createCloudProvider('claude');
    const google = createCloudProvider('google');
    registry.register(claude);
    registry.register(google);
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'ai_provider') return null;
      if (key === 'ai_google_api_key') return 'AIza-test';
      return null;
    });

    const result = await registry.resolveActive();

    expect(result).toEqual({ provider: google, source: 'auto' });
  });

  it('returns undefined when ai_provider is unset AND no cloud API keys are configured', async () => {
    registry.register(createCloudProvider('openai'));
    registry.register(createCloudProvider('claude'));
    registry.register(createCloudProvider('google'));
    mockSettings.get.mockResolvedValue(null);

    const result = await registry.resolveActive();

    expect(result).toBeUndefined();
  });

  it('skips self-hosted providers in auto-pick', async () => {
    // Ollama is self-hosted and keyless — even with no other providers
    // registered, auto-pick must NOT select it. The only legitimate way
    // to use Ollama is an explicit `ai_provider=ollama` setting.
    const ollama = createMockProvider('ollama'); // selfHosted: true (default)
    registry.register(ollama);
    mockSettings.get.mockResolvedValue(null);

    const result = await registry.resolveActive();

    expect(result).toBeUndefined();
  });

  it('honours explicit ai_provider=ollama even though auto-pick would skip it', async () => {
    const ollama = createMockProvider('ollama');
    registry.register(ollama);
    mockSettings.get.mockResolvedValue('ollama');

    const result = await registry.resolveActive();

    expect(result).toEqual({ provider: ollama, source: 'setting' });
  });

  it('prefers explicit setting over auto-pick when both are available', async () => {
    const claude = createCloudProvider('claude');
    const google = createCloudProvider('google');
    registry.register(claude);
    registry.register(google);
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'ai_provider') return 'google';
      if (key === 'ai_claude_api_key') return 'sk-ant-test';
      if (key === 'ai_google_api_key') return 'AIza-test';
      return null;
    });

    const result = await registry.resolveActive();

    // Should be google (the explicit setting) with source 'setting',
    // even though claude has a key and is registered first.
    expect(result).toEqual({ provider: google, source: 'setting' });
  });
});
