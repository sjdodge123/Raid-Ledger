import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { LlmProvider } from './llm-provider.interface';
import { AI_DEFAULTS, AI_SETTING_KEYS } from './llm.constants';
import type { SettingKey } from '../drizzle/schema';

/**
 * Resolution outcome for the active LLM provider.
 *
 * `source` distinguishes operator configuration (`'setting'`) from the
 * hard-coded `AI_DEFAULTS.provider` fallback (`'default'`) so the LLM
 * service can surface that signal in logs (ROK-1114).
 */
export interface ActiveProviderResolution {
  provider: LlmProvider;
  source: 'setting' | 'default';
}

/**
 * Registry of available LLM providers.
 * Manages provider registration and active-provider resolution via settings.
 */
@Injectable()
export class LlmProviderRegistry {
  private providers = new Map<string, LlmProvider>();

  constructor(private readonly settings: SettingsService) {}

  /** Register an LLM provider. */
  register(provider: LlmProvider): void {
    this.providers.set(provider.key, provider);
  }

  /** Resolve a provider by key. */
  resolve(key: string): LlmProvider | undefined {
    return this.providers.get(key);
  }

  /** Resolve the currently active provider from settings. */
  async resolveActive(): Promise<ActiveProviderResolution | undefined> {
    const configured = await this.settings.get(
      AI_SETTING_KEYS.PROVIDER as SettingKey,
    );
    const source: 'setting' | 'default' =
      configured == null ? 'default' : 'setting';
    const key = configured ?? AI_DEFAULTS.provider;
    const provider = this.providers.get(key);
    if (!provider) return undefined;
    return { provider, source };
  }

  /** List all registered providers. */
  list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
