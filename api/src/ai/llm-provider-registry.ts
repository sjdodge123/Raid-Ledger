import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { LlmProvider } from './llm-provider.interface';
import { AI_SETTING_KEYS } from './llm.constants';
import type { SettingKey } from '../drizzle/schema';

/**
 * Resolution outcome for the active LLM provider.
 *
 * `source` distinguishes operator configuration (`'setting'`) from the
 * auto-pick fallback (`'auto'`, picked when `ai_provider` is unset but
 * a cloud provider has an API key configured) so the LLM service can
 * surface that signal in logs (ROK-1114).
 */
export interface ActiveProviderResolution {
  provider: LlmProvider;
  source: 'setting' | 'auto';
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

  /**
   * Resolve the currently active provider.
   *
   * 1. If `ai_provider` is set in `app_settings` and matches a registered
   *    provider, return it with `source: 'setting'`.
   * 2. Otherwise auto-pick the first registered cloud provider whose API
   *    key is configured (`ai_<key>_api_key`), returning `source: 'auto'`.
   *    Self-hosted/keyless providers are skipped in auto-pick — they need
   *    explicit operator selection via `ai_provider`.
   * 3. If neither path yields a provider, return `undefined`.
   */
  async resolveActive(): Promise<ActiveProviderResolution | undefined> {
    const configured = await this.settings.get(
      AI_SETTING_KEYS.PROVIDER as SettingKey,
    );
    if (configured) {
      const provider = this.providers.get(configured);
      if (provider) return { provider, source: 'setting' };
    }
    return this.autoPickProvider();
  }

  /** Auto-pick the first cloud provider whose API key is configured. */
  private async autoPickProvider(): Promise<
    ActiveProviderResolution | undefined
  > {
    for (const provider of this.providers.values()) {
      if (provider.selfHosted) continue;
      if (!provider.requiresApiKey) continue;
      const settingKey = `ai_${provider.key}_api_key` as SettingKey;
      const apiKey = await this.settings.get(settingKey);
      if (apiKey) return { provider, source: 'auto' };
    }
    return undefined;
  }

  /** List all registered providers. */
  list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
