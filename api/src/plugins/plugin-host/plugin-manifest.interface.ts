/** Describes an external API integration a plugin manages (e.g., Blizzard API). */
export interface PluginIntegration {
  key: string;
  name: string;
  description: string;
  icon?: string;
  /** Setting keys in app_settings that hold this integration's credentials */
  credentialKeys: string[];
  /** Human-readable field labels for the admin UI, ordered to match credentialKeys */
  credentialLabels: string[];
  /** EventEmitter event name emitted when this integration's config changes */
  settingsEvent?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; url?: string };
  gameSlugs: string[];
  capabilities: string[];
  settingKeys?: string[];
  integrations?: PluginIntegration[];
  dependencies?: string[];
}

export const PLUGIN_EVENTS = {
  INSTALLED: 'plugin.installed',
  UNINSTALLED: 'plugin.uninstalled',
  ACTIVATED: 'plugin.activated',
  DEACTIVATED: 'plugin.deactivated',
  CONFIG_UPDATED: 'plugin.config.updated',
} as const;

export * from './extension-types';
export * from './extension-points';
