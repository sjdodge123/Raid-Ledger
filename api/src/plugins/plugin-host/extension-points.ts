/**
 * Extension point interfaces that plugins implement to provide
 * game-specific behavior. Core services resolve adapters from
 * the plugin registry at runtime.
 */

import type {
  ExternalCharacterProfile,
  ExternalInferredSpecialization,
  ExternalCharacterEquipment,
  ExternalCharacterProfessions,
  ExternalRealm,
  ExternalContentInstance,
  ExternalContentInstanceDetail,
  CronJobDefinition,
} from './extension-types';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateCharacterDto,
  UpdateCharacterDto,
} from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';

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
  fetchProfessions?(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string | null,
  ): Promise<ExternalCharacterProfessions | null>;
}

/** Provides game content data (realms, instances) */
export interface ContentProvider {
  readonly gameSlugs: string[];
  fetchRealms(region: string, gameVariant?: string): Promise<ExternalRealm[]>;
  fetchInstances(
    region: string,
    gameVariant?: string,
  ): Promise<ExternalContentInstance[]>;
  fetchInstanceDetail(
    instanceId: number,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalContentInstanceDetail | null>;
}

/**
 * @deprecated Use {@link DataEnricher} instead (ROK-269).
 * Enriches event data with game-specific information (no core consumer yet).
 */
export interface EventEnricher {
  readonly gameSlugs: string[];
  enrichEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Extension point for plugins that fetch supplementary character or event data
 * from third-party APIs (Raider.IO M+ scores, WarcraftLogs parses, etc.).
 * Unlike CharacterSyncAdapter (which owns the import/refresh lifecycle),
 * enrichers layer additional data onto existing characters/events.
 *
 * Results are cached in the `enrichments` table — enrichers do NOT run on page load.
 * They execute via BullMQ background jobs (scheduled or on manual refresh).
 *
 * Multiple enrichers can register for the same game slug (ROK-269).
 */
export interface DataEnricher {
  /** Unique enricher identifier, e.g. 'raider-io', 'warcraftlogs' */
  readonly key: string;
  /** Which games this enricher applies to */
  readonly gameSlugs: string[];
  /** Optional refresh interval in milliseconds (defaults to 24h) */
  readonly refreshIntervalMs?: number;
  /** Enrich a character with supplementary data */
  enrichCharacter?(
    character: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Enrich an event with supplementary data */
  enrichEvent?(
    event: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
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

/** Describes a login method surfaced to the frontend */
export interface LoginMethod {
  key: string;
  label: string;
  icon?: string;
  loginPath: string;
  /** Hex color for the provider button (e.g. '#5865F2') */
  color?: string;
}

/** Pluggable authentication strategy provided by a plugin */
export interface AuthProvider {
  readonly providerKey: string;
  getLoginMethod(): LoginMethod;
  isConfigured(): boolean | Promise<boolean>;
}

/** A db or transaction handle, as handed to a CharacterIdentityProvider. */
export type IdentityDb = PostgresJsDatabase<typeof schema>;

/** Plugin-owned identity rules for MANUAL characters of a game (ROK-1733). */
export interface CharacterIdentityProvider {
  readonly gameSlugs: string[];
  /** Owning plugin id — core skips the provider while that plugin is inactive. */
  readonly pluginSlug: string;
  /** Validate + normalize a create DTO (throws 400). */
  prepareCreate(
    game: { slug: string },
    dto: CreateCharacterDto,
  ): CreateCharacterDto;
  /** Validate + normalize an update; may run its own claim check (throws 400/409). */
  prepareUpdate(
    db: IdentityDb,
    userId: number,
    game: { slug: string },
    character: { id: string; gameId: number; region: string | null },
    dto: UpdateCharacterDto,
  ): Promise<UpdateCharacterDto>;
  /** Cross-player claim check for a realm-less character, inside the create tx (throws 409). */
  checkClaim(
    tx: IdentityDb,
    args: { gameId: number; userId: number; name: string; region: string },
  ): Promise<void>;
  /** Map a lost race on the core ruleset-identity index to a 409; return to let the caller continue. */
  rethrowIdentityViolation(
    error: unknown,
    name: string,
    region: string | null | undefined,
  ): void;
}

/** Well-known extension point identifiers */
export const EXTENSION_POINTS = {
  CHARACTER_SYNC: 'character-sync',
  CONTENT_PROVIDER: 'content-provider',
  EVENT_ENRICHER: 'event-enricher',
  DATA_ENRICHER: 'data-enricher',
  SETTINGS_PROVIDER: 'settings-provider',
  CRON_REGISTRAR: 'cron-registrar',
  AUTH_PROVIDER: 'auth-provider',
  CHARACTER_IDENTITY: 'character-identity',
} as const;
