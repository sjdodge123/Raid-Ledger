/**
 * ROK-2352 P1-1 — which group an LFG session belongs to, and the voice-join
 * conversion scoped to that group.
 *
 * A session's group is read from the hands converted into it (provenance, the
 * same JOIN `openLfgNowEventWhere` relies on). Only one group converts into a
 * session (Start now and the threshold spawn are both scoped), so the key is
 * unambiguous; `ORDER BY group_key` makes any legacy mix resolve to `''`.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { openLfgNowEventWhere } from './lfg-playing.helpers';
import { lfgGroupLockKey } from './lfg.constants';
import { clearNowSiblings } from './lfg-lock-in-group.helpers';
import { liveGroupRow } from './lfg-write.helpers';

/**
 * The group key of the hands converted into `eventId`, or null when none did
 * (not LFG-born). Never throws: a failed read means "unknown group" (null),
 * which callers treat as the Any / fold group.
 */
export async function lfgSessionGroupKey(
  db: LfgDb,
  eventId: number,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ groupKey: schema.lfgIntents.groupKey })
      .from(schema.lfgIntents)
      .where(eq(schema.lfgIntents.convertedToEventId, eventId))
      .orderBy(asc(schema.lfgIntents.groupKey))
      .limit(1);
    return typeof row?.groupKey === 'string' ? row.groupKey : null;
  } catch {
    return null;
  }
}

/**
 * When `eventId` is an OPEN LFG-born session of the game, the group it
 * belongs to; null otherwise (a Quick Play, an ended session, another game).
 * Asked about the exact event, so two open sessions of one game (the Any
 * group's and a keyed Start now) can never be confused (`LIMIT 1` on the
 * game alone picked an arbitrary one).
 */
export async function findOpenLfgBornSessionGroup(
  db: LfgDb,
  gameId: number,
  eventId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ groupKey: schema.lfgIntents.groupKey })
    .from(schema.events)
    .innerJoin(
      schema.lfgIntents,
      eq(schema.lfgIntents.convertedToEventId, schema.events.id),
    )
    .where(and(openLfgNowEventWhere(gameId), eq(schema.events.id, eventId)))
    .orderBy(asc(schema.lfgIntents.groupKey))
    .limit(1);
  return row?.groupKey ?? null;
}

/** What a voice-join conversion did. */
export interface JoinerConversion {
  converted: number;
  /** Q1: the joiner, when their other `now` hand in the game was cleared. */
  clearedSiblingUserIds: number[];
}

/**
 * Convert the joiner's live hand in the session's group ONLY (spec §3.8 /
 * Q1): their hands in other groups stay, except that their other `now` hands
 * clear, exactly as at lock-in / Start now. Runs under the per-game advisory
 * lock every lock-in / convert / start-now takes (§3.2).
 *
 * @param db - Drizzle handle; a transaction is opened here.
 * @param gameId - The session's game.
 * @param userId - The joiner.
 * @param eventId - The session they joined.
 * @param groupKey - The session's group (from {@link findOpenLfgBornSessionGroup}).
 * @param now - Liveness instant.
 */
export function convertJoinerHand(
  db: LfgDb,
  gameId: number,
  userId: number,
  eventId: number,
  groupKey: string,
  now: Date = new Date(),
): Promise<JoinerConversion> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    const rows = await tx
      .update(schema.lfgIntents)
      .set({
        status: 'converted',
        convertedToPollId: null,
        convertedToEventId: eventId,
        convertedAt: sql`statement_timestamp()`, // TDB:953
      })
      .where(
        and(
          liveGroupRow(tx, gameId, now),
          eq(schema.lfgIntents.userId, userId),
          eq(schema.lfgIntents.groupKey, groupKey),
        ),
      )
      .returning({ id: schema.lfgIntents.id });
    if (rows.length === 0) return { converted: 0, clearedSiblingUserIds: [] };
    const cleared = await clearNowSiblings(tx, gameId, [userId], groupKey);
    return { converted: rows.length, clearedSiblingUserIds: cleared };
  });
}
