/**
 * ROK-1573 — convert a live LFG group into an event created from it.
 *
 * Runs inside `POST /events`, BEFORE the creator's signup: the signup listener
 * clears the creator's `active` intent, after which `isGroupParticipant` would
 * reject them and the provenance would be lost (spec "Critical verified
 * finding").
 */
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { isGroupParticipant, liveGroupRow } from './lfg-write.helpers';
import { lfgGroupLockKey } from './lfg.constants';

/** Flip every live intent on the game to `converted` → this event. */
async function convertLiveRows(
  tx: LfgDb,
  gameId: number,
  eventId: number,
): Promise<number[]> {
  const rows = await tx
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: eventId,
    })
    .where(liveGroupRow(tx, gameId, new Date()))
    .returning({ userId: schema.lfgIntents.userId });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Convert the caller's live group on `gameId` to `eventId`.
 *
 * Holds the same group advisory lock as the +1 path so a hand raised mid-write
 * either lands before the conversion (and converts) or after it (and starts a
 * new group) — never half-way.
 *
 * @param db - Drizzle handle.
 * @param userId - The event creator; must be a live participant.
 * @param gameId - Game whose group is converting.
 * @param eventId - The event just created.
 * @returns The converted members' user ids; `[]` when the caller is not a
 *   participant or nothing was live.
 */
export function convertGroupToEvent(
  db: LfgDb,
  userId: number,
  gameId: number,
  eventId: number,
): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    const participant = await isGroupParticipant(tx, userId, gameId, {
      eventId,
    });
    if (!participant) return [];
    return convertLiveRows(tx, gameId, eventId);
  });
}
