import { Logger } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ADULT_THEME_IDS, ADULT_KEYWORDS } from './igdb.constants';

const logger = new Logger('IgdbModerationHelpers');

/** Result of a game moderation action. */
export interface ModerationResult {
  success: boolean;
  message: string;
  name: string;
}

/** Fetch a game by ID for moderation actions. */
async function findGameById(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
  includeIgdbId = false,
) {
  const cols = includeIgdbId
    ? {
        id: schema.games.id,
        name: schema.games.name,
        igdbId: schema.games.igdbId,
      }
    : { id: schema.games.id, name: schema.games.name };

  return db
    .select(cols)
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
}

/**
 * Toggle a game's hidden status.
 * @param db - Database connection
 * @param id - Game ID
 * @param hidden - Whether to hide or unhide
 * @param action - Action label for logging
 * @returns Moderation result
 */
export async function toggleGameVisibility(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
  hidden: boolean,
  action: string,
): Promise<ModerationResult> {
  const existing = await findGameById(db, id);
  if (existing.length === 0) {
    return { success: false, message: 'Game not found', name: '' };
  }

  await db.update(schema.games).set({ hidden }).where(eq(schema.games.id, id));
  logger.log(`Game "${existing[0].name}" (id=${id}) ${action} via admin UI`);

  const msg = hidden
    ? `Game "${existing[0].name}" hidden from users.`
    : `Game "${existing[0].name}" is now visible to users.`;
  return { success: true, message: msg, name: existing[0].name };
}

/**
 * Ban a game by ID. Tombstones it from sync, search, and discovery.
 * @param db - Database connection
 * @param id - Game ID
 * @returns Moderation result
 */
export async function banGame(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<ModerationResult> {
  const existing = await findGameById(db, id);
  if (existing.length === 0) {
    return { success: false, message: 'Game not found', name: '' };
  }

  await db
    .update(schema.games)
    .set({ banned: true, hidden: true })
    .where(eq(schema.games.id, id));

  logger.log(`Game "${existing[0].name}" (id=${id}) banned via admin UI`);
  return {
    success: true,
    message: `Game "${existing[0].name}" has been banned.`,
    name: existing[0].name,
  };
}

/**
 * Unban a previously banned game. Returns game info for re-import.
 * @param db - Database connection
 * @param id - Game ID
 * @returns Result including igdbId for re-import
 */
export async function unbanGame(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<ModerationResult & { igdbId: number | null }> {
  const existing = await findGameById(db, id, true);
  if (existing.length === 0) {
    return {
      success: false,
      message: 'Game not found',
      name: '',
      igdbId: null,
    };
  }

  await db
    .update(schema.games)
    .set({ banned: false, hidden: false })
    .where(eq(schema.games.id, id));

  const game = existing[0] as { id: number; name: string; igdbId: number };
  logger.log(`Game "${game.name}" (id=${id}) unbanned via admin UI`);
  return {
    success: true,
    message: `Game "${game.name}" has been unbanned and restored.`,
    name: game.name,
    igdbId: game.igdbId,
  };
}

/**
 * Auto-hide games with adult themes (one-time sweep).
 * @param db - Database connection
 * @returns Number of games hidden
 */
export async function hideAdultGames(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number> {
  const result = await db
    .update(schema.games)
    .set({ hidden: true })
    .where(
      and(
        eq(schema.games.hidden, false),
        or(
          sql`${schema.games.themes}::jsonb @> ANY(ARRAY[${sql.raw(ADULT_THEME_IDS.map((id) => `'[${id}]'::jsonb`).join(','))}])`,
          or(
            ...ADULT_KEYWORDS.map((kw) => ilike(schema.games.name, `%${kw}%`)),
          ),
        ),
      ),
    )
    .returning({ id: schema.games.id });

  if (result.length > 0) {
    logger.log(`Auto-hidden ${result.length} games with adult themes/keywords`);
  }
  return result.length;
}
