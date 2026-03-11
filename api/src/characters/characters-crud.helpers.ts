/**
 * Character CRUD helpers.
 * Extracted from characters.service.ts for file size compliance (ROK-719).
 */
import {
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { eq, and, asc, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  CharacterDto,
  CreateCharacterDto,
  RefreshCharacterDto,
} from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import {
  fetchFullProfile,
  buildSyncUpdateFields,
} from './characters-sync.helpers';
import {
  mapCharacterToDto,
  resolveMainStatus,
  demoteExistingMain,
} from './characters-mapping.helpers';
import { checkDuplicateClaim } from './characters-import.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
};

/** Build insert values for a new character. */
export function buildCreateValues(
  userId: number,
  dto: CreateCharacterDto,
  shouldBeMain: boolean,
) {
  return {
    userId,
    gameId: dto.gameId,
    name: dto.name,
    realm: dto.realm ?? null,
    class: dto.class ?? null,
    spec: dto.spec ?? null,
    role: dto.role ?? null,
    isMain: shouldBeMain,
    itemLevel: dto.itemLevel ?? null,
    avatarUrl: dto.avatarUrl ?? null,
  };
}

/** Execute the create transaction (main-swap + insert). */
export async function executeCreateTx(
  db: Db,
  userId: number,
  dto: CreateCharacterDto,
  logger: Logger,
): Promise<CharacterDto> {
  return db.transaction(async (tx) => {
    await checkDuplicateClaim(tx, dto.gameId, userId, dto.name, dto.realm);
    const { shouldBeMain, charCount } = await resolveMainStatus(
      tx,
      userId,
      dto.gameId,
      dto.isMain,
    );
    if (shouldBeMain && charCount > 0)
      await demoteExistingMain(tx, userId, dto.gameId);
    const [character] = await tx
      .insert(schema.characters)
      .values(buildCreateValues(userId, dto, shouldBeMain))
      .returning();
    logger.log(
      `User ${userId} created character ${character.id} (${character.name})${shouldBeMain ? ' [main]' : ''}`,
    );
    return mapCharacterToDto(character);
  });
}

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
  if (remaining.length > 0 && !remaining.some((c) => c.isMain)) {
    const promote = remaining[0];
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

/** Prepare refresh parameters and validate. */
export function prepareRefresh(
  character: CharacterDto,
  dto: RefreshCharacterDto,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
): { region: string; gameVariant: string; adapter: CharacterSyncAdapter } {
  if (!character.realm)
    throw new NotFoundException(
      'Character has no realm — cannot refresh from external source',
    );
  enforceCooldown(character.lastSyncedAt);
  const region = character.region ?? dto.region;
  const gameVariant =
    (character.gameVariant as RefreshCharacterDto['gameVariant']) ??
    dto.gameVariant;
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
  return mapCharacterToDto(updated);
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

/** Sync all externally-linked characters. */
export async function syncAllCharacters(
  db: Db,
  findAdapter: (variant?: string) => CharacterSyncAdapter | undefined,
  logger: Logger,
): Promise<{ synced: number; failed: number }> {
  const externalCharacters = await db
    .select()
    .from(schema.characters)
    .where(
      and(
        isNotNull(schema.characters.region),
        isNotNull(schema.characters.gameVariant),
      ),
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
async function resolveNsPrefix(db: Db, gameId: number): Promise<string | null> {
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
  const adapter = findAdapter(char.gameVariant as string);
  if (!adapter) {
    logger.debug(
      `No adapter for character ${char.id} (gameId: ${char.gameId}), skipping`,
    );
    return 'skipped';
  }
  const nsPrefix = await resolveNsPrefix(db, char.gameId);
  const { profile, talents, equipment } = await fetchFullProfile(
    adapter,
    char.name,
    char.realm!,
    char.region!,
    nsPrefix,
  );
  await db
    .update(schema.characters)
    .set(buildSyncUpdateFields(profile, equipment, talents))
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
