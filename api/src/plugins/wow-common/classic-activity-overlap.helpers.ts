import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  WOW_CLASSIC_ACTIVITY_NAME,
  type ClassicGameIds,
} from './classic-activity-attribution.helpers';

/**
 * ROK-2259 — no double credit. A player in a bound voice channel gets two
 * sessions for one play: presence (Discord's raw "World of Warcraft Classic")
 * and voice (the detector's resolved games.name). The sessions table has no
 * source column, so a voice row is recognised by its name: a row credited to
 * Forever/Anniversary under any name other than the raw Classic name. While
 * one is open the raw-name presence row stays uncredited (same rule as
 * migration 0307 step 3).
 */
const sessions = schema.gameActivitySessions;
const RAW_NAME = WOW_CLASSIC_ACTIVITY_NAME.toLowerCase();

function openClassicRowsOf(userId: number, ids: ClassicGameIds) {
  return and(
    eq(sessions.userId, userId),
    isNull(sessions.endedAt),
    inArray(sessions.gameId, [ids.foreverId, ids.anniversaryId]),
  );
}

/** True while `userId` has an open WoW-credited voice (resolved-name) row. */
export async function hasOpenVoiceClassicSession(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  ids: ClassicGameIds,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        openClassicRowsOf(userId, ids),
        sql`lower(${sessions.discordActivityName}) <> ${RAW_NAME}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** A voice row opened: drop the credit of the user's open raw-name rows. */
export async function uncreditOpenRawClassicSessions(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  ids: ClassicGameIds,
): Promise<void> {
  await db
    .update(sessions)
    .set({ gameId: null })
    .where(
      and(
        openClassicRowsOf(userId, ids),
        sql`lower(${sessions.discordActivityName}) = ${RAW_NAME}`,
      ),
    );
}
