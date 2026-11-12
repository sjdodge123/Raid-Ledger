/**
 * ROK-2187 — the GG <year> DM wave. Row-level idempotency on `gg_snapshots`:
 * claim ≤25 unsent rows per tick (`FOR UPDATE SKIP LOCKED`, so two ticks never
 * share a row), stamp `dm_sent_at` on success, release the claim on failure.
 * A claim older than `GG_DM_STALE_CLAIM_MINUTES` (process died mid-send) is
 * claimable again. Deactivated users are never claimed.
 */
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { ggSnapshots, notificationDedup } from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** At most this many DMs per 5-minute tick (AC3, F4). */
export const GG_DM_BATCH = 25;

/** A claim this old without `dm_sent_at` is treated as abandoned. */
export const GG_DM_STALE_CLAIM_MINUTES = 30;

/** One claimed snapshot row. */
export interface GgDmClaim {
  id: number;
  userId: number;
}

/** Counts from one wave. */
export interface GgDmWaveResult {
  claimed: number;
  sent: number;
  failed: number;
}

/** Claim up to `limit` unsent rows of `year` for this tick. */
export async function claimGgDmBatch(
  db: Db,
  year: number,
  limit: number = GG_DM_BATCH,
): Promise<GgDmClaim[]> {
  const rows = await db.execute<{ id: number; user_id: number }>(sql`
    UPDATE gg_snapshots SET dm_claimed_at = now()
    WHERE id IN (
      SELECT g.id FROM gg_snapshots g
      JOIN users u ON u.id = g.user_id
      WHERE g.year = ${year}
        AND g.dm_sent_at IS NULL
        AND u.deactivated_at IS NULL
        AND (g.dm_claimed_at IS NULL
          OR g.dm_claimed_at < now() - make_interval(mins => ${GG_DM_STALE_CLAIM_MINUTES}))
      ORDER BY g.id
      LIMIT ${limit}
      FOR UPDATE OF g SKIP LOCKED
    )
    RETURNING id, user_id`);
  return Array.from(rows).map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
  }));
}

/** Stamp a claimed row as delivered. */
export async function markGgDmSent(db: Db, id: number): Promise<void> {
  await db
    .update(ggSnapshots)
    .set({ dmSentAt: new Date() })
    .where(eq(ggSnapshots.id, id));
}

/** Give a claim back so a later tick retries it. */
export async function releaseGgDmClaim(db: Db, id: number): Promise<void> {
  await db
    .update(ggSnapshots)
    .set({ dmClaimedAt: null })
    .where(and(eq(ggSnapshots.id, id), isNull(ggSnapshots.dmSentAt)));
}

/**
 * Claim one batch and deliver each row through `send`; a throw releases that
 * row's claim and the wave continues with the next one.
 */
export async function runGgDmWave(
  db: Db,
  year: number,
  send: (claim: GgDmClaim) => Promise<void>,
): Promise<GgDmWaveResult> {
  const claims = await claimGgDmBatch(db, year);
  const result: GgDmWaveResult = { claimed: claims.length, sent: 0, failed: 0 };
  for (const claim of claims) {
    try {
      await send(claim);
      await markGgDmSent(db, claim.id);
      result.sent += 1;
    } catch {
      await releaseGgDmClaim(db, claim.id);
      result.failed += 1;
    }
  }
  return result;
}

/** When `year` was announced (the live dedup row's `created_at`), else null. */
export async function findGgAnnouncedAt(
  db: Db,
  dedupKey: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: notificationDedup.createdAt })
    .from(notificationDedup)
    .where(
      and(
        eq(notificationDedup.dedupKey, dedupKey),
        or(
          isNull(notificationDedup.expiresAt),
          gt(notificationDedup.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  return row?.createdAt ?? null;
}

/** Clear every DM claim/stamp of `year` (DEMO fixture reset only). */
export async function resetGgDmState(db: Db, year: number): Promise<number> {
  const rows = await db
    .update(ggSnapshots)
    .set({ dmClaimedAt: null, dmSentAt: null })
    .where(eq(ggSnapshots.year, year))
    .returning({ id: ggSnapshots.id });
  return rows.length;
}
