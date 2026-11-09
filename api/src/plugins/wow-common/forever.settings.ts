/**
 * Plugin-owned settings + event for the WoW: Forever runtime config (ROK-1717).
 *
 * The keys live in the blizzard plugin (declared in `manifest.ts` settingKeys,
 * so uninstall deletes them), not in core `SETTING_KEYS`. `SettingKey` is a
 * closed union, so they are cast — existing precedent in
 * `ai/llm-provider-registry.ts`.
 */
import type { SettingKey } from '../../drizzle/schema/app-settings';

/** Admin-set Forever namespace prefix. Absent = the `forever` default (ROK-2102). */
export const WOW_FOREVER_NAMESPACE_PREFIX_KEY =
  'wow_forever_namespace_prefix' as SettingKey;

/**
 * Forever Armory import kill switch (ROK-1722): `'false'` = disabled.
 * Absent (or a legacy `'true'`) = enabled.
 */
export const WOW_FOREVER_ARMORY_IMPORT_KEY =
  'wow_forever_armory_import' as SettingKey;

/**
 * Forever classic quest import kill switch (ROK-2143): `'false'` = off.
 * Off also makes the quest read path ignore the Blizzard overlay.
 */
export const WOW_FOREVER_QUEST_IMPORT_KEY =
  'wow_forever_quest_import' as SettingKey;

/** JSON `ForeverQuestImportReport` — the last quest import run (ROK-2143). */
export const WOW_FOREVER_QUEST_IMPORT_STATUS_KEY =
  'wow_forever_quest_import_status' as SettingKey;

/** The Forever setting keys, for the plugin manifest. */
export const WOW_FOREVER_SETTING_KEYS: string[] = [
  WOW_FOREVER_NAMESPACE_PREFIX_KEY,
  WOW_FOREVER_ARMORY_IMPORT_KEY,
  WOW_FOREVER_QUEST_IMPORT_KEY,
  WOW_FOREVER_QUEST_IMPORT_STATUS_KEY,
];

/** JSON {@link ForeverProbeResultDto}-shaped latest probe run (ROK-1716, D1). */
export const WOW_FOREVER_PROBE_LAST_RESULT_KEY =
  'wow_forever_probe_last_result' as SettingKey;

/** JSON `{ prefix, at }` of the first Skyborne match — the alert dedupe (D4). */
export const WOW_FOREVER_PROBE_FOUND_KEY =
  'wow_forever_probe_found' as SettingKey;

/** JSON string[] of admin-added candidate prefixes. Absent = none. */
export const WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY =
  'wow_forever_probe_extra_candidates' as SettingKey;

/** Raw `<realmOrRuleset>/<name>` for the optional profile check (D5). */
export const WOW_FOREVER_PROBE_CHARACTER_KEY =
  'wow_forever_probe_character' as SettingKey;

/** Realmless `<slug>` or `<realm>/<slug>` guild for the roster check (ROK-2102). */
export const WOW_FOREVER_PROBE_GUILD_KEY =
  'wow_forever_probe_guild' as SettingKey;

/** The probe's five setting keys, for the plugin manifest. */
export const WOW_FOREVER_PROBE_SETTING_KEYS: string[] = [
  WOW_FOREVER_PROBE_LAST_RESULT_KEY,
  WOW_FOREVER_PROBE_FOUND_KEY,
  WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY,
  WOW_FOREVER_PROBE_CHARACTER_KEY,
  WOW_FOREVER_PROBE_GUILD_KEY,
];

/**
 * JSON `WowForeverRealmRulesetsDto` — the admin-maintained realm →
 * ruleset map (ROK-1739, D1). Absent = no rows.
 */
export const WOW_FOREVER_REALM_RULESETS_KEY =
  'wow_forever_realm_rulesets' as SettingKey;

/** The realm-ruleset map's setting key, for the plugin manifest. */
export const WOW_FOREVER_REALM_RULESET_SETTING_KEYS: string[] = [
  WOW_FOREVER_REALM_RULESETS_KEY,
];

/** Plugin-local event emitted after an admin saves the Forever config. */
export const WOW_FOREVER_CONFIG_UPDATED = 'blizzard.forever-config.updated';

/** Payload of {@link WOW_FOREVER_CONFIG_UPDATED}. */
export interface WowForeverConfigUpdatedPayload {
  /** The new prefix as Blizzard should receive it (default included). */
  namespacePrefix: string;
}
