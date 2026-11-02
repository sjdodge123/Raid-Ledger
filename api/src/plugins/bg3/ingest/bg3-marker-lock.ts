/**
 * ROK-1960 P2-3 — the per-user lock that serialises every write of a user's
 * `bg3-save` latest-wins markers (`companion_ingest_latest`) with "Delete my
 * BG3 data".
 *
 * Why a lock and not the row: a NEW campaign key's marker is an uncommitted
 * INSERT, invisible to the delete's `DELETE … WHERE user_id = …`, so without
 * this the delete can clear nothing for that key, the ingest's save can land
 * (and be deleted) on either side of it, and a marker can outlive its save —
 * after which a re-upload of that save is acked `stale` and never restored.
 *
 * Per-user order (every BG3 writer keeps it): blob lock → gallery lock →
 * THIS marker lock → marker rows → campaign lock (`lockBg3UserCampaigns`) →
 * key / default / save rows. Nothing takes this lock after the campaign lock.
 *
 * Transaction lock: held to commit/rollback, re-entrant on the same tx.
 * Keyspace: one-arg bigint `hashtextextended` on a `bg3-save-markers:` name,
 * like the campaign lock — disjoint from the two-arg `(class, id)` locks
 * elsewhere in the api, and no other lock name uses this prefix.
 */
import { sql } from 'drizzle-orm';
import type { Bg3LockableTx } from '../campaigns/bg3-campaign-lock';

/** The advisory-lock name for one user's `bg3-save` markers. */
export function bg3MarkerLockKey(userId: number): string {
  return `bg3-save-markers:${userId}`;
}

/** Takes the per-user marker lock on `tx` (see the module doc for order). */
export async function lockBg3UserMarkers(
  tx: Bg3LockableTx,
  userId: number,
): Promise<void> {
  const key = bg3MarkerLockKey(userId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
