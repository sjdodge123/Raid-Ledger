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
import { sql } from 'drizzle-orm';
import type { LfgGroupScope } from './lfg-group-scope.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { convertGroup, type LfgConversionTarget } from './lfg-write.helpers';
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
