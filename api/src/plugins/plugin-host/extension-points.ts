/**
 * Extension point interfaces that plugins implement to provide
 * game-specific behavior. Core services resolve adapters from
 * the plugin registry at runtime.
 */

import type {
  ExternalCharacterProfile,
  ExternalInferredSpecialization,
  ExternalCharacterEquipment,
  ExternalRealm,
  ExternalContentInstance,
  ExternalContentInstanceDetail,
  CronJobDefinition,
} from './extension-types';

/** Provides character data fetch + sync capabilities for a game */
export interface CharacterSyncAdapter {
  readonly gameSlugs: string[];
  resolveGameSlugs(gameVariant?: string): string[];
  fetchProfile(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterProfile>;
  fetchSpecialization(
    name: string,
    realm: string,
    region: string,
    characterClass: string,
    gameVariant?: string,
  ): Promise<ExternalInferredSpecialization>;
  fetchEquipment(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterEquipment>;
}

/** Provides game content data (realms, instances) */
export interface ContentProvider {
  readonly gameSlugs: string[];
  fetchRealms(region: string, gameVariant?: string): Promise<ExternalRealm[]>;
  fetchInstances(gameVariant?: string): Promise<ExternalContentInstance[]>;
  fetchInstanceDetail(
    instanceId: number,
    gameVariant?: string,
  ): Promise<ExternalContentInstanceDetail | null>;
}

/** Enriches event data with game-specific information (no core consumer yet) */
export interface EventEnricher {
  readonly gameSlugs: string[];
  enrichEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** Formalizes plugin settings management */
export interface SettingsProvider {
  readonly settingKeys: string[];
  validateSetting?(key: string, value: string): boolean;
  onSettingChanged?(key: string, value: string): void | Promise<void>;
}

/** Provides cron job definitions for a plugin */
export interface CronRegistrar {
  getCronJobs(): CronJobDefinition[];
}

/** Well-known extension point identifiers */
export const EXTENSION_POINTS = {
  CHARACTER_SYNC: 'character-sync',
  CONTENT_PROVIDER: 'content-provider',
  EVENT_ENRICHER: 'event-enricher',
  SETTINGS_PROVIDER: 'settings-provider',
  CRON_REGISTRAR: 'cron-registrar',
} as const;
