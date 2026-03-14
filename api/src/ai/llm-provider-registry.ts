import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { LlmProvider } from './llm-provider.interface';
import { AI_DEFAULTS, AI_SETTING_KEYS } from './llm.constants';
import type { SettingKey } from '../drizzle/schema';

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
  async resolveActive(): Promise<LlmProvider | undefined> {
    const key =
      (await this.settings.get(AI_SETTING_KEYS.PROVIDER as SettingKey)) ??
      AI_DEFAULTS.provider;
    return this.providers.get(key);
  }

  /** List all registered providers. */
  list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
