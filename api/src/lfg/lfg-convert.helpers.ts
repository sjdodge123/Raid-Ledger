/**
 * Conversion-target validation for `POST /lfg/:gameId/convert`
 * (ROK-1451 rework — M1 / Codex P2-c).
 *
 * `converted_to_poll_id` / `converted_to_event_id` are provenance: they claim
 * "this group became THAT poll/event". Writing them straight from the request
 * body let a nonexistent id surface as an FK 500 and let a real-but-unrelated
 * id record a false claim for every member of the group. Both are resolved
 * here before anything is written.
 */
import { and, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import type { LfgConversionTarget } from './lfg-write.helpers';

/** The poll's game, or `undefined` when no such poll exists. */
async function pollGameId(
  db: LfgDb,
  pollId: number,
): Promise<number | undefined> {
  const [row] = await db
    .select({ gameId: schema.communityLineupMatches.gameId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, pollId))
    .limit(1);
  return row?.gameId;
}

/** The event's game (nullable), or `undefined` when no such event exists. */
async function eventGameId(
  db: LfgDb,
  eventId: number,
): Promise<number | null | undefined> {
  const [row] = await db
    .select({ gameId: schema.events.gameId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ? row.gameId : undefined;
}

/**
 * Resolve the game the conversion target belongs to.
 *
 * @param db - Drizzle handle.
 * @param target - Exactly one of `pollId` / `eventId` (the schema enforces it).
 * @returns The target's `gameId`, `null` when the target has no game, or
 *   `undefined` when the target row does not exist at all.
 */
export function resolveTargetGameId(
  db: LfgDb,
  target: LfgConversionTarget,
): Promise<number | null | undefined> {
  return target.pollId !== undefined
    ? pollGameId(db, target.pollId)
    : eventGameId(db, target.eventId as number);
}

/**
 * SQL predicate: a `cleared`, unexpired intent whose holder has a non-declined
 * signup on `eventId` (TDB:967).
 *
 * `POST /events` signs the creator up, and `LfgSignupListener` then clears
 * their intent. Without this a member who created (or joined) the event first
 * could no longer convert their own group into it. Event targets only; a
 * poll target never matches anything here.
 *
 * Requires `lfg_intents` to be in the query.
 *
 * @param db - Drizzle handle (the sub-select must run on the same connection).
 * @param eventId - The conversion target event.
 * @param now - Instant the expiry check is measured against.
 */
export function clearedBySignupTo(
  db: LfgDb,
  eventId: number,
  now: Date,
): SQL | undefined {
  const signedUp = db
    .select({ id: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        ne(schema.eventSignups.status, 'declined'),
      ),
    );
  return and(
    eq(schema.lfgIntents.status, 'cleared'),
    gt(schema.lfgIntents.expiresAt, now),
    inArray(schema.lfgIntents.userId, signedUp),
  );
}

/**
 * Flip the caller's signup-cleared intent (see {@link clearedBySignupTo}) to
 * `converted` with the event's provenance, exactly as `convertGroup` writes an
 * active member's row, so the caller stays in the converted roster
 * (ROK-1454 D5). Idempotent: a converted row no longer matches `cleared`.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group converted.
 * @param userId - The caller.
 * @param target - The conversion target; a poll target converts nothing.
 * @returns How many rows converted.
 */
export async function convertSignedUpCaller(
  db: LfgDb,
  gameId: number,
  userId: number,
  target: LfgConversionTarget,
): Promise<number> {
  if (target.eventId === undefined) return 0;
  const rows = await db
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: target.eventId,
      convertedAt: sql`statement_timestamp()`, // TDB:953 — DB clock at the UPDATE
    })
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.userId, userId),
        clearedBySignupTo(db, target.eventId, new Date()),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}
