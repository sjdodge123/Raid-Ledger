import type { PluginManifest } from '../plugins/plugin-host/plugin-manifest.interface';
import { AI_SETTING_KEYS } from './llm.constants';

/** Plugin manifest for the AI Features plugin. */
export const AI_MANIFEST: PluginManifest = {
  id: 'ai',
  name: 'AI Features',
  version: '1.0.0',
  description:
    'Provider-agnostic LLM infrastructure for AI-powered features like chat and dynamic categories.',
  author: { name: 'Raid Ledger' },
  gameSlugs: [],
  capabilities: ['ai-chat', 'ai-categories'],
  settingKeys: [
    AI_SETTING_KEYS.PROVIDER,
    AI_SETTING_KEYS.MODEL,
    AI_SETTING_KEYS.OLLAMA_URL,
    AI_SETTING_KEYS.CHAT_ENABLED,
    AI_SETTING_KEYS.DYNAMIC_CATEGORIES_ENABLED,
    AI_SETTING_KEYS.OPENAI_API_KEY,
    AI_SETTING_KEYS.CLAUDE_API_KEY,
    AI_SETTING_KEYS.GOOGLE_API_KEY,
  ],
  integrations: [
    {
      key: 'ai',
      name: 'AI Features',
      description: 'Multi-provider LLM inference — configure providers in the AI plugin panel.',
      credentialKeys: [AI_SETTING_KEYS.PROVIDER],
      credentialLabels: ['Active Provider'],
    },
  ],
};
