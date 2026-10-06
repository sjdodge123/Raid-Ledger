/**
 * Plugin-owned settings + event for the WoW: Forever runtime config (ROK-1717).
 *
 * The keys live in the blizzard plugin (declared in `manifest.ts` settingKeys,
 * so uninstall deletes them), not in core `SETTING_KEYS`. `SettingKey` is a
 * closed union, so they are cast — existing precedent in
 * `ai/llm-provider-registry.ts`.
 */
import type { SettingKey } from '../../drizzle/schema/app-settings';

/** Admin-set Forever namespace prefix. Absent = the `classicforever` default. */
export const WOW_FOREVER_NAMESPACE_PREFIX_KEY =
  'wow_forever_namespace_prefix' as SettingKey;

/** `'true'` when Forever Armory import is enabled. Absent = disabled. */
export const WOW_FOREVER_ARMORY_IMPORT_KEY =
  'wow_forever_armory_import' as SettingKey;

/** Both Forever setting keys, for the plugin manifest. */
export const WOW_FOREVER_SETTING_KEYS: string[] = [
  WOW_FOREVER_NAMESPACE_PREFIX_KEY,
  WOW_FOREVER_ARMORY_IMPORT_KEY,
];

/** Plugin-local event emitted after an admin saves the Forever config. */
export const WOW_FOREVER_CONFIG_UPDATED = 'blizzard.forever-config.updated';

/** Payload of {@link WOW_FOREVER_CONFIG_UPDATED}. */
export interface WowForeverConfigUpdatedPayload {
  /** The new prefix as Blizzard should receive it (default included). */
  namespacePrefix: string;
}
