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
  ],
  integrations: [
    {
      key: 'ollama',
      name: 'Ollama (Local)',
      description: 'Self-hosted LLM inference via Ollama.',
      credentialKeys: [AI_SETTING_KEYS.OLLAMA_URL],
      credentialLabels: ['Ollama URL'],
    },
  ],
};
