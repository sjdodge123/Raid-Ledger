/**
 * Optional external (Armory) import hooks of a CharacterIdentityProvider
 * (ROK-1722, extending the ROK-1733 extension point). Core stays
 * game-agnostic: it asks the active identity providers for a policy and lets
 * the provider that owns an import shape its identity columns and merge it.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CharacterDto,
  ImportWowCharacterDto,
} from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type {
  EnrichedProfile,
  OptionalSyncFields,
} from '../../characters/characters-sync.helpers';

/** Snapshot of a provider's external-import rules, read once per request. */
export interface ExternalImportPolicy {
  /** Variant a realmless (ruleset-keyed) linked row refreshes under, if any. */
  readonly realmlessVariant?: string;
  /** Throws (e.g. 403) while import for `variant` is switched off. */
  assertAllowed(variant: string | null | undefined): void;
  /** False when the nightly bulk sync must leave a row of `variant` out. */
  includeInBulkSync(variant: string | null): boolean;
}

/** Identity columns of an imported row. */
export interface ExternalImportFields {
  name: string;
  realm: string | null;
  ruleset?: string;
  externalId?: string;
}

/** Everything a provider's in-transaction import step needs. */
export interface ExternalImportCtx {
  userId: number;
  gameId: number;
  profile: EnrichedProfile['profile'];
  dto: ImportWowCharacterDto;
  sync: OptionalSyncFields;
  logger: { log: (msg: string) => void };
}

/** The optional hooks; every one absent = core's default (realm-keyed) path. */
export interface CharacterExternalImportHooks {
  /** Current external-import policy (kill switches, realmless variant). */
  externalImportPolicy?(): Promise<ExternalImportPolicy>;
  /** True when this provider owns the identity of the given import. */
  ownsExternalImport?(dto: ImportWowCharacterDto): boolean;
  /** Identity columns for an owned import. */
  externalImportFields?(
    profile: EnrichedProfile['profile'],
    dto: ImportWowCharacterDto,
  ): ExternalImportFields;
  /** In the import tx: 409 on another owner; merge into the caller's own row, or undefined to insert. */
  mergeExternalImport?(
    tx: PostgresJsDatabase<typeof schema>,
    ctx: ExternalImportCtx,
  ): Promise<CharacterDto | undefined>;
}
