/**
 * Character import/merge helpers.
 * Extracted from characters.service.ts for file size compliance (ROK-719).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq, and, ne, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  CharacterDto,
  ImportWowCharacterDto,
} from '@raid-ledger/contract';
import {
  fetchFullProfile,
  buildSyncUpdateFieldsFromSync,
  type EnrichedProfile,
  type OptionalSyncFields,
} from './characters-sync.helpers';
import type { CharacterIdentityProvider } from '../plugins/plugin-host/extension-points';
import type {
  ExternalImportCtx,
  ExternalImportFields,
} from '../plugins/plugin-host/character-external-import.types';
import {
  mapCharacterToDto,
  resolveMainStatus,
  demoteExistingMain,
} from './characters-mapping.helpers';
import { defined } from '../common/defined.helpers';
import {
  checkIdentityClaim,
  type IdentityClaimOpts,
} from './characters-identity.helpers';

export { resolveGameByVariant } from './characters-import-game.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = { log: (msg: string) => void };
type CharProfile = EnrichedProfile['profile'];
type Identity = CharacterIdentityProvider | undefined;
/** Import ctx plus the identity provider that owns the import (if any). */
type ImportCtx = ExternalImportCtx & { identity?: Identity };

/** Identity columns: the owning provider's, else profile name + realm. */
function importIdentityFields(
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  identity: Identity,
): ExternalImportFields {
  return (
    identity?.externalImportFields?.(profile, dto) ?? {
      name: profile.name,
      realm: profile.realm,
    }
  );
}

/** Check if a character name+realm is already claimed by another user. */
export async function checkDuplicateClaim(
  tx: Db,
  gameId: number,
  userId: number,
  name: string,
  realm?: string | null,
  opts: IdentityClaimOpts = {},
): Promise<void> {
  // ROK-1721/1733: a realm-less character with a region is claimed through
  // its game's identity provider; realm-less without one stays per-user only.
  if (!realm) return checkIdentityClaim(tx, { gameId, userId, name }, opts);
  const [existingClaim] = await tx
    .select({ id: schema.characters.id, userId: schema.characters.userId })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, gameId),
        ne(schema.characters.userId, userId),
        sql`lower(${schema.characters.name}) = lower(${name})`,
        eq(schema.characters.realm, realm),
      ),
    )
    .limit(1);
  if (existingClaim)
    throw new ConflictException(
      `${name} on ${realm} is already claimed by another player`,
    );
}

/** Validate that a user exists. */
export async function validateUserExists(
  db: Db,
  userId: number,
): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user)
    throw new NotFoundException(
      `User ${userId} not found — cannot import character`,
    );
}

/** Build import insert values from profile and sync fields. */
export function buildImportInsertValues(
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  sync: OptionalSyncFields,
  shouldBeMain: boolean,
  identity?: Identity,
) {
  const syncFields = buildSyncUpdateFieldsFromSync(profile, sync, {
    region: dto.region,
    gameVariant: dto.gameVariant,
  });
  return {
    userId,
    gameId,
    ...importIdentityFields(profile, dto, identity),
    ...syncFields,
    isMain: shouldBeMain,
  };
}

/** Resolve main status and demote existing main if needed. */
export async function resolveAndDemoteMain(
  tx: Db,
  userId: number,
  gameId: number,
  isMain: boolean | undefined,
): Promise<boolean> {
  const { shouldBeMain, charCount } = await resolveMainStatus(
    tx,
    userId,
    gameId,
    isMain,
  );
  if (shouldBeMain && charCount > 0)
    await demoteExistingMain(tx, userId, gameId);
  return shouldBeMain;
}

/** Insert the import values, log, and map to a DTO. */
async function insertImportedCharacter(
  tx: Db,
  userId: number,
  profile: CharProfile,
  values: ReturnType<typeof buildImportInsertValues>,
  shouldBeMain: boolean,
  logger: Logger,
): Promise<CharacterDto> {
  const [inserted] = await tx
    .insert(schema.characters)
    .values(values)
    .returning();
  const character = defined(inserted, 'imported character row');
  logger.log(
    `User ${userId} imported character ${character.id} (${profile.name}-${profile.realm})${shouldBeMain ? ' [main]' : ''}`,
  );
  return mapCharacterToDto(character);
}

/** Resolve main status then build the insert values for an import. */
async function resolveMainAndBuildValues(
  tx: Db,
  ctx: ImportCtx,
): Promise<{
  values: ReturnType<typeof buildImportInsertValues>;
  shouldBeMain: boolean;
}> {
  const { userId, gameId, profile, dto, sync, identity } = ctx;
  const shouldBeMain = await resolveAndDemoteMain(
    tx,
    userId,
    gameId,
    dto.isMain,
  );
  const values = buildImportInsertValues(
    userId,
    gameId,
    profile,
    dto,
    sync,
    shouldBeMain,
    identity,
  );
  return { values, shouldBeMain };
}

/**
 * Claim check before an import insert. An import owned by an identity
 * provider (ROK-1722) goes through its merge hook; others check the realm.
 * @returns the merged character, or undefined when the caller should insert.
 */
async function claimOrMergeImport(
  tx: Db,
  ctx: ImportCtx,
): Promise<CharacterDto | undefined> {
  const { gameId, userId, profile, identity } = ctx;
  if (identity?.mergeExternalImport)
    return identity.mergeExternalImport(tx, ctx);
  await checkDuplicateClaim(tx, gameId, userId, profile.name, profile.realm);
  return undefined;
}

/**
 * Execute the import transaction body.
 * @param identity the provider that owns this import's identity, if any.
 */
export async function executeImportTx(
  tx: Db,
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  sync: OptionalSyncFields,
  logger: Logger,
  identity?: Identity,
): Promise<CharacterDto> {
  const ctx = { userId, gameId, profile, dto, sync, logger, identity };
  const merged = await claimOrMergeImport(tx, ctx);
  if (merged) return merged;
  const { values, shouldBeMain } = await resolveMainAndBuildValues(tx, ctx);
  return insertImportedCharacter(
    tx,
    userId,
    profile,
    values,
    shouldBeMain,
    logger,
  );
}

/** Find an existing character by user+game+name+realm. */
export async function findExistingByProfile(
  db: Db,
  userId: number,
  gameId: number,
  name: string,
  realm: string | null,
) {
  const [existing] = await db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, userId),
        eq(schema.characters.gameId, gameId),
        sql`lower(${schema.characters.name}) = lower(${name})`,
        realm === null
          ? isNull(schema.characters.realm)
          : eq(schema.characters.realm, realm),
      ),
    )
    .limit(1);
  return existing;
}

/** Find an existing character to merge into, or throw if none exists. */
async function requireExistingForMerge(
  db: Db,
  userId: number,
  gameId: number,
  profile: CharProfile,
): Promise<typeof schema.characters.$inferSelect> {
  const existing = await findExistingByProfile(
    db,
    userId,
    gameId,
    profile.name,
    profile.realm,
  );
  if (!existing)
    throw new ConflictException(
      `Character ${profile.name} on ${profile.realm} already exists`,
    );
  return existing;
}

/** Merge imported data into an existing local character. */
export async function mergeIntoExisting(
  db: Db,
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  sync: OptionalSyncFields,
  logger: Logger,
): Promise<CharacterDto> {
  const existing = await requireExistingForMerge(db, userId, gameId, profile);
  const fields = buildSyncUpdateFieldsFromSync(profile, sync, {
    region: dto.region,
    gameVariant: dto.gameVariant,
  });
  const [merged] = await db
    .update(schema.characters)
    .set(fields)
    .where(eq(schema.characters.id, existing.id))
    .returning();
  logger.log(
    `User ${userId} merged import into existing character ${existing.id} (${profile.name}-${profile.realm})`,
  );
  return mapCharacterToDto(defined(merged, 'merged character row'));
}

/** Insert an imported character, merging on conflict. */
export async function insertOrMergeImport(
  db: Db,
  userId: number,
  gameId: number,
  fetched: Awaited<ReturnType<typeof fetchFullProfile>>,
  dto: ImportWowCharacterDto,
  logger: Logger,
  isUniqueViolation: (err: unknown, name: string) => boolean,
  identity?: Identity,
): Promise<CharacterDto> {
  const { profile, equipment, talents, professions, armoryQuests } = fetched;
  const sync: OptionalSyncFields = {
    equipment,
    talents,
    professions,
    armoryQuests,
  };
  try {
    return await db.transaction((tx) =>
      executeImportTx(tx, userId, gameId, profile, dto, sync, logger, identity),
    );
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'unique_user_game_character'))
      return mergeIntoExisting(db, userId, gameId, profile, dto, sync, logger);
    identity?.rethrowIdentityViolation(error, profile.name, dto.region);
    throw error;
  }
}
