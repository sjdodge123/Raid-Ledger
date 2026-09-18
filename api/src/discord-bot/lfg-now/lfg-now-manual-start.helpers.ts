/**
 * The reads and the one write the MANUAL "start playing now" branch needs
 * (ROK-1613).
 *
 * Separate from `lfg-now-spawn.helpers.ts` so that file keeps its shape under
 * the 300-line cap, and one-directional: the spawn helper imports this one,
 * never the reverse.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LfgNowHand } from './lfg-now-spawn.types';

type Db = PostgresJsDatabase<typeof schema>;

/** What a manual start needs from the request: who pressed the button. */
export interface ManualStart {
  /** Creator of the event, rostered regardless of their hand's horizon. */
  starterUserId: number;
}

/**
 * EVERY live hand on a game, earliest first — `week` hands included.
 *
 * The sibling read `listLiveNowHands` filters `urgency = 'now'`, which is
 * exactly why a manual start cannot use it: the reported starter held a WEEK
 * hand, so the now-hand list is empty and `hands[0]` is `undefined` (spec
 * finding 2). The manual branch rosters the starter off THIS list and invites
 * everyone else on it.
 *
 * @param db - The spawn transaction handle.
 * @param gameId - Game whose group is starting.
 * @param now - Liveness instant.
 * @returns The live hands, ordered by `created_at` ascending.
 */
export async function listLiveGroupHands(
  db: Db,
  gameId: number,
  now: Date = new Date(),
): Promise<LfgNowHand[]> {
  return db
    .select({
      userId: schema.lfgIntents.userId,
      createdAt: schema.lfgIntents.createdAt,
      discordId: schema.users.discordId,
      username: schema.users.username,
      discordAvatarHash: schema.users.avatar,
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
        isNull(schema.users.deactivatedAt),
        isNull(schema.users.bannedAt),
        sql`${schema.lfgIntents.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(schema.lfgIntents.createdAt));
}

/**
 * Convert ONE holder's live hand — the starter's — onto the session.
 *
 * OPERATOR-PENDING (spec `planning-artifacts/specs/ROK-1613.md` §4): AC3 wants
 * the whole group's intents converted so the page stops reading "N looking",
 * AC4 wants a week-hander who ignores the invite to KEEP their hand. The two
 * cannot both hold, and AC4 is the operator's own wording, so only the starter
 * converts here; an invitee converts when they ACCEPT, through the normal join
 * path. Flipping this to `convertGroup(tx, gameId, target)` is the whole change
 * if the operator rules the other way.
 *
 * @param db - The spawn transaction handle.
 * @param gameId - Game whose group is starting.
 * @param userId - The starter.
 * @param target - The event the hand converted into.
 * @returns How many rows flipped (0 or 1).
 */
export async function convertStarterIntent(
  db: Db,
  gameId: number,
  userId: number,
  target: { eventId: number },
): Promise<number> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: target.eventId,
    })
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.status, 'active'),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}
