/**
 * ROK-1960 F5 — the ONE per-user lock every writer of a user's BG3 campaign
 * filing takes, first, inside its transaction: the key bind, unbind,
 * default-campaign change, and ingest's campaign resolution + row write.
 *
 * Per USER (not per key) because `setDefault` files the user's unassigned
 * rows of every key at once. Without it a bind could pass its cross-hub
 * guard while a save is unassigned, a concurrent `setDefault` file that save
 * into hub A, and the bind's UPDATE then move it A→B unconfirmed.
 *
 * Single lock, so there is no lock-order to keep between these writers. It
 * is a transaction lock: held to commit/rollback, re-entrant on the same tx.
 * Keyspace: one-arg bigint `hashtextextended` on a `bg3-campaigns:` name —
 * the two-arg `(class, id)` locks elsewhere in the api are a disjoint
 * keyspace, and no other lock name uses this prefix.
 */
import { sql, type SQL } from 'drizzle-orm';

export function bg3CampaignLockKey(userId: number): string {
  return `bg3-campaigns:${userId}`;
}

/** Any transaction handle (campaigns repo tx, companion ingest tx). */
export interface Bg3LockableTx {
  execute(query: SQL): PromiseLike<unknown>;
}

export async function lockBg3UserCampaigns(
  tx: Bg3LockableTx,
  userId: number,
): Promise<void> {
  const key = bg3CampaignLockKey(userId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}
