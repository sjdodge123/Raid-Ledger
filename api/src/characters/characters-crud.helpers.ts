/**
 * Character CRUD helpers.
 * Extracted from characters.service.ts for file size compliance (ROK-719).
 * The create path lives in characters-create.helpers.ts (ROK-1738).
 */
import {
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { eq, and, asc, isNotNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CharacterDto, RefreshCharacterDto } from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import {
  fetchFullProfile,
  buildSyncUpdateFields,
} from './characters-sync.helpers';
import { mapCharacterToDto } from './characters-mapping.helpers';
import { defined } from '../common/defined.helpers';
import type { ExternalImportPolicy } from '../plugins/plugin-host/character-external-import.types';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
};

/** After deletion, promote the lowest-order char to main if none exists. */
export async function autoPromoteAfterDelete(
  db: Db,
  userId: number,
  gameId: number,
  logger: Logger,
): Promise<void> {
  const remaining = await db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, userId),
        eq(schema.characters.gameId, gameId),
      ),
    )
    .orderBy(asc(schema.characters.displayOrder));
  const [promote] = remaining;
  if (promote !== undefined && !remaining.some((c) => c.isMain)) {
    await db
      .update(schema.characters)
      .set({ isMain: true, updatedAt: new Date() })
      .where(eq(schema.characters.id, promote.id));
    logger.log(
      `Auto-promoted character ${promote.id} (${promote.name}) to main`,
    );
  }
}

/** Enforce 5-minute refresh cooldown. */
export function enforceCooldown(lastSyncedAt: string | null): void {
  if (!lastSyncedAt) return;
  const cooldownMs = 5 * 60 * 1000;
  const elapsed = Date.now() - new Date(lastSyncedAt).getTime();
  if (elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    throw new HttpException(
      `Refresh on cooldown. Try again in ${remaining}s`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Thrown when a row has no realm and no provider-owned realmless variant. */
function noRealm(): never {
  throw new NotFoundException(
    'Character has no realm — cannot refresh from external source',
  );
}

/**
 * Variant a refresh runs under. A realmless row (ruleset set) is owned by the
 * identity provider that declares a realmless variant (ROK-1722), so the
 * request's 'retail' default is never stamped onto it.
 */
function refreshVariant(
  character: CharacterDto,
  dto: RefreshCharacterDto,
  policy: ExternalImportPolicy,
): string {
  if (character.realm) return character.gameVariant ?? dto.gameVariant;
  if (!character.ruleset) return noRealm();
  return policy.realmlessVariant ?? noRealm();
}

/**
 * Prepare refresh parameters and validate.
 * @param policy external-import policy from the identity providers; its gate
 *   may refuse the variant (e.g. a plugin kill switch).
 */
export function prepareRefresh(
  character: CharacterDto,
  dto: RefreshCharacterDto,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
  policy: ExternalImportPolicy,
): { region: string; gameVariant: string; adapter: CharacterSyncAdapter } {
  if (!character.realm && !character.ruleset) noRealm();
  enforceCooldown(character.lastSyncedAt);
  const region = character.region ?? dto.region;
  const gameVariant = refreshVariant(character, dto, policy);
  policy.assertAllowed(gameVariant);
  const adapter = findAdapter(gameVariant);
  if (!adapter)
    throw new NotFoundException(
      'No character sync adapter found for this game variant',
    );
  return { region, gameVariant, adapter };
}

/** Apply refresh fields to DB and return updated character. */
export async function applyRefreshUpdate(
  db: Db,
  userId: number,
  characterId: string,
  fields: Record<string, unknown>,
  logger: Logger,
): Promise<CharacterDto> {
  const [updated] = await db
    .update(schema.characters)
    .set(fields)
    .where(eq(schema.characters.id, characterId))
    .returning();
  logger.log(
    `User ${userId} refreshed character ${characterId} from external source`,
  );
  return mapCharacterToDto(defined(updated, 'refreshed character row'));
}

/** Find a single character by ID with ownership check. */
export async function findOneOwned(
  db: Db,
  userId: number,
  characterId: string,
): Promise<CharacterDto> {
  const [character] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1);
  if (!character)
    throw new NotFoundException(`Character ${characterId} not found`);
  if (character.userId !== userId)
    throw new ForbiddenException('You do not own this character');
  return mapCharacterToDto(character);
}

/**
 * Sync all externally-linked characters.
 * @param policy external-import policy: rows it excludes from the bulk sync
 *   are left out entirely (counted neither synced nor failed).
 */
export async function syncAllCharacters(
  db: Db,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
  logger: Logger,
  policy: ExternalImportPolicy,
): Promise<{ synced: number; failed: number }> {
  const linked = await findSyncableCharacters(db);
  const externalCharacters = linked.filter((c) =>
    policy.includeInBulkSync(c.gameVariant),
  );
  let synced = 0;
  let failed = 0;
  for (const char of externalCharacters) {
    const result = await syncSingleCharacter(db, char, findAdapter, logger);
    if (result === 'synced') synced++;
    else if (result === 'failed') failed++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { synced, failed };
}

/** Armory-linked rows the nightly sync may refresh. */
async function findSyncableCharacters(
  db: Db,
): Promise<(typeof schema.characters.$inferSelect)[]> {
  return db
    .select()
    .from(schema.characters)
    .where(
      and(
        isNotNull(schema.characters.region),
        // ROK-1722: Armory-linked rows only (game_variant set). A manual
        // realmless row keeps game_variant NULL and stays out; an imported
        // one (realm NULL, ruleset set) syncs by region + name.
        isNotNull(schema.characters.gameVariant),
        or(
          isNotNull(schema.characters.realm),
          isNotNull(schema.characters.ruleset),
        ),
      ),
    );
}

/** Sync a single external character. */
async function syncSingleCharacter(
  db: Db,
  char: typeof schema.characters.$inferSelect,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
  logger: Logger,
): Promise<'synced' | 'failed' | 'skipped'> {
  try {
    return await performCharacterSync(db, char, findAdapter, logger);
  } catch (err) {
    logger.warn(
      `Auto-sync failed for character ${char.id} (${char.name}): ${err}`,
    );
    return 'failed';
  }
}

/** Look up apiNamespacePrefix from the game row. */
export async function resolveNsPrefix(
  db: Db,
  gameId: number,
): Promise<string | null> {
  const [game] = await db
    .select({ apiNamespacePrefix: schema.games.apiNamespacePrefix })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game?.apiNamespacePrefix ?? null;
}

/** Perform sync for a single character. */
async function performCharacterSync(
  db: Db,
  char: typeof schema.characters.$inferSelect,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
  logger: Logger,
): Promise<'synced' | 'skipped'> {
  const adapter = findAdapter(char.gameVariant ?? undefined);
  const region = char.region;
  if (!adapter || !region) {
    logger.debug(
      `No adapter for character ${char.id} (gameId: ${char.gameId}), skipping`,
    );
    return 'skipped';
  }
  const nsPrefix = await resolveNsPrefix(db, char.gameId);
  const { profile, talents, equipment, professions } = await fetchFullProfile(
    adapter,
    char.name,
    char.realm,
    region,
    nsPrefix,
  );
  await db
    .update(schema.characters)
    .set(buildSyncUpdateFields(profile, equipment, talents, professions))
    .where(eq(schema.characters.id, char.id));
  return 'synced';
}

/** Check if an error is a Drizzle unique constraint violation. */
export function isUniqueViolation(
  error: unknown,
  constraintName: string,
): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message ?? '';
  const causeMsg =
    error.cause instanceof Error ? (error.cause.message ?? '') : '';
  return msg.includes(constraintName) || causeMsg.includes(constraintName);
}
