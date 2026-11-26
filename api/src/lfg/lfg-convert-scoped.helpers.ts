/**
 * ROK-2352 P2-8 — a convert (`POST /lfg/:gameId/convert`) flips its group's
 * hands under the SAME per-game advisory lock every other LFG group write
 * takes (`createIntent`, the now-spawn), so a hand raised mid-convert either
 * lands before the flip (and converts) or after it (and stays live) — never
 * half of each.
 *
 * Kept out of `lfg.service.ts`, which sits at the 300-line cap.
 *
 * Ruled (APPLY): a convert to a poll does NOT clear the members' `now` hands
 * in other groups — unlike a Start now, nobody is playing yet.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import {
  groupScopeFilter,
  type LfgGroupScope,
} from './lfg-group-scope.helpers';
import type { LfgDb } from './lfg-query.helpers';
import {
  convertGroup,
  liveGroupRow,
  type LfgConversionTarget,
} from './lfg-write.helpers';
import { lfgGroupLockKey } from './lfg.constants';

/**
 * Convert one group's live hands inside a transaction behind the game's group
 * lock.
 *
 * @param db - Drizzle handle; a transaction is opened here.
 * @param gameId - Game whose group converts.
 * @param target - The poll or event the group became.
 * @param scope - The group (null = every live hand of the game, the fold).
 * @returns How many hands converted (0 = an idempotent retry).
 */
export function convertGroupLocked(
  db: LfgDb,
  gameId: number,
  target: LfgConversionTarget,
  scope: LfgGroupScope,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    return convertGroup(tx, gameId, target, scope);
  });
}

/**
 * ROK-2352 (delta MAJOR 2) — a keyed ATTACH converts only the `now` hands it
 * signs up: the named users' live `now` hands in the group. The group's
 * tonight/week hands stay live, since a keyed Start now converts only the
 * starter and those players have no signup on the session.
 *
 * @param db - Drizzle handle (the spawn transaction).
 * @param gameId - Game whose group is attaching.
 * @param eventId - The open session the hands join.
 * @param scope - The keyed group.
 * @param userIds - The users being attached (empty → no-op).
 * @returns How many hands converted.
 */
export async function convertAttachedNowHands(
  db: LfgDb,
  gameId: number,
  eventId: number,
  scope: LfgGroupScope,
  userIds: number[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await db
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: null,
      convertedToEventId: eventId,
      convertedAt: sql`statement_timestamp()`, // TDB:953
    })
    .where(
      and(
        liveGroupRow(db, gameId, new Date()),
        groupScopeFilter(scope),
        eq(schema.lfgIntents.urgency, 'now'),
        inArray(schema.lfgIntents.userId, userIds),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}
