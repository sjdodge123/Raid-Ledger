/**
 * Character import/merge helpers.
 * Extracted from characters.service.ts for file size compliance (ROK-719).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq, and, ne, ilike, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  CharacterDto,
  ImportWowCharacterDto,
} from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import type { ExternalCharacterProfessions } from '../plugins/plugin-host/extension-types';
import { variantToNamespacePrefix } from '../plugins/wow-common/blizzard.constants';
import {
  fetchFullProfile,
  buildSyncUpdateFields,
} from './characters-sync.helpers';
import {
  mapCharacterToDto,
  resolveMainStatus,
  demoteExistingMain,
} from './characters-mapping.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = { log: (msg: string) => void };
type CharProfile = { name: string; realm: string; [k: string]: unknown };

/** Check if a character name+realm is already claimed by another user. */
export async function checkDuplicateClaim(
  tx: Db,
  gameId: number,
  userId: number,
  name: string,
  realm?: string | null,
): Promise<void> {
  if (!realm) return;
  const [existingClaim] = await tx
    .select({ id: schema.characters.id, userId: schema.characters.userId })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, gameId),
        ne(schema.characters.userId, userId),
        ilike(schema.characters.name, name),
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

/** Resolve game by slug candidates + namespace prefix from adapter. */
export async function resolveGameByVariant(
  db: Db,
  adapter: CharacterSyncAdapter,
  gameVariant: string,
): Promise<typeof schema.games.$inferSelect> {
  const slugCandidates = adapter.resolveGameSlugs(gameVariant);
  const nsPrefix = variantToNamespacePrefix(gameVariant);
  const nsFilter =
    nsPrefix === null
      ? isNull(schema.games.apiNamespacePrefix)
      : eq(schema.games.apiNamespacePrefix, nsPrefix);
  const [game] = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.slug, slugCandidates), nsFilter))
    .limit(1);
  if (!game) throw new NotFoundException('Game not found in the games catalog');
  return game;
}

/** Build import insert values from profile and sync fields. */
export function buildImportInsertValues(
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  equipment: unknown,
  talents: unknown,
  professions: ExternalCharacterProfessions | null,
  shouldBeMain: boolean,
) {
  const syncFields = buildSyncUpdateFields(
    profile as never,
    equipment,
    talents,
    professions,
    { region: dto.region, gameVariant: dto.gameVariant },
  );
  return {
    userId,
    gameId,
    name: profile.name,
    realm: profile.realm,
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

/** Execute the import transaction body. */
export async function executeImportTx(
  tx: Db,
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  equipment: unknown,
  talents: unknown,
  professions: ExternalCharacterProfessions | null,
  logger: Logger,
): Promise<CharacterDto> {
  await checkDuplicateClaim(tx, gameId, userId, profile.name, profile.realm);
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
    equipment,
    talents,
    professions,
    shouldBeMain,
  );
  const [character] = await tx
    .insert(schema.characters)
    .values(values)
    .returning();
  logger.log(
    `User ${userId} imported character ${character.id} (${profile.name}-${profile.realm})${shouldBeMain ? ' [main]' : ''}`,
  );
  return mapCharacterToDto(character);
}

/** Find an existing character by user+game+name+realm. */
export async function findExistingByProfile(
  db: Db,
  userId: number,
  gameId: number,
  name: string,
  realm: string,
) {
  const [existing] = await db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, userId),
        eq(schema.characters.gameId, gameId),
        ilike(schema.characters.name, name),
        eq(schema.characters.realm, realm),
      ),
    )
    .limit(1);
  return existing;
}

/** Merge imported data into an existing local character. */
export async function mergeIntoExisting(
  db: Db,
  userId: number,
  gameId: number,
  profile: CharProfile,
  dto: ImportWowCharacterDto,
  equipment: unknown,
  talents: unknown,
  professions: ExternalCharacterProfessions | null,
  logger: Logger,
): Promise<CharacterDto> {
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
  const fields = buildSyncUpdateFields(
    profile as never,
    equipment,
    talents,
    professions,
    { region: dto.region, gameVariant: dto.gameVariant },
  );
  const [merged] = await db
    .update(schema.characters)
    .set(fields)
    .where(eq(schema.characters.id, existing.id))
    .returning();
  logger.log(
    `User ${userId} merged import into existing character ${existing.id} (${profile.name}-${profile.realm})`,
  );
  return mapCharacterToDto(merged);
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
): Promise<CharacterDto> {
  try {
    return await db.transaction((tx) =>
      executeImportTx(
        tx,
        userId,
        gameId,
        fetched.profile,
        dto,
        fetched.equipment,
        fetched.talents,
        fetched.professions,
        logger,
      ),
    );
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'unique_user_game_character'))
      return mergeIntoExisting(
        db,
        userId,
        gameId,
        fetched.profile,
        dto,
        fetched.equipment,
        fetched.talents,
        fetched.professions,
        logger,
      );
    throw error;
  }
}
