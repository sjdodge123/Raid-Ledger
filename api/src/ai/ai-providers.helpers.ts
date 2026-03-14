import type { LlmProvider } from './llm-provider.interface';
import { AI_SETTING_KEYS } from './llm.constants';

/** API key setting key for each cloud provider. */
const PROVIDER_KEY_MAP: Record<string, string> = {
  openai: AI_SETTING_KEYS.OPENAI_API_KEY,
  claude: AI_SETTING_KEYS.CLAUDE_API_KEY,
  google: AI_SETTING_KEYS.GOOGLE_API_KEY,
};

/** DTO returned for each provider in the list endpoint. */
export interface AiProviderInfoDto {
  key: string;
  displayName: string;
  requiresApiKey: boolean;
  selfHosted: boolean;
  configured: boolean;
  available: boolean;
  active: boolean;
  setupInProgress?: boolean;
}

/**
 * Resolve the settings key used to store a provider's API key.
 * Returns undefined for self-hosted providers (e.g. Ollama).
 */
export function getApiKeySettingKey(providerKey: string): string | undefined {
  return PROVIDER_KEY_MAP[providerKey];
}

/**
 * Build a provider info DTO from a provider instance and status flags.
 */
export function buildProviderInfo(
  provider: LlmProvider,
  configured: boolean,
  available: boolean,
  active: boolean,
): AiProviderInfoDto {
  return {
    key: provider.key,
    displayName: provider.displayName,
    requiresApiKey: provider.requiresApiKey,
    selfHosted: provider.selfHosted,
    configured,
    available,
    active,
  };
}
