/**
 * ROK-2252 — `NotificationDedupService.checkAndMarkSentMany`: the batch form
 * of `checkAndMarkSent`. Same semantics per key (Redis fast path, valid DB
 * row = already sent and re-warms Redis, expired row is taken over, the
 * `ON CONFLICT DO NOTHING` insert decides a race), but a fixed number of
 * round-trips whatever the key count: one MGET, one SELECT, one DELETE of
 * expired rows, one INSERT and at most two Redis pipelines.
 */
import type { Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';

/** The stores (and logger) a batch claim reads and writes. */
export interface DedupBatchStores {
  db: PostgresJsDatabase<typeof schema>;
  redis: Pick<Redis, 'mget' | 'pipeline'>;
  logger: Pick<Logger, 'warn'>;
}

/**
 * Claim every key not already sent.
 *
 * @param keys - Dedup keys; duplicates are claimed once.
 * @param ttlSeconds - TTL in seconds, or null for a permanent claim.
 * @returns The keys THIS call newly claimed (the caller should send these).
 */
export async function claimDedupKeys(
  stores: DedupBatchStores,
  keys: readonly string[],
  ttlSeconds: number | null,
): Promise<Set<string>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Set();
  const cached = await stores.redis.mget(...unique);
  const misses = unique.filter((_, i) => !cached[i]);
  if (misses.length === 0) return new Set();
  const dbHits = await findValidDbKeys(stores.db, misses);
  // Warm before claiming: a throw here leaves no claim stranded.
  await warmKeys(stores.redis, [...dbHits], ttlSeconds);
  const fresh = misses.filter((k) => !dbHits.has(k));
  if (fresh.length === 0) return new Set();
  const claimed = await insertClaims(stores.db, fresh, ttlSeconds);
  await warmWonClaims(stores, claimed, ttlSeconds);
  return claimed;
}

/**
 * Warm Redis for won claims. The PG row IS the claim; Redis is only a cache
 * (ROK-2100 Codex P2), so a failed warm must not turn won claims into a throw.
 */
async function warmWonClaims(
  stores: DedupBatchStores,
  claimed: ReadonlySet<string>,
  ttlSeconds: number | null,
): Promise<void> {
  try {
    await warmKeys(stores.redis, [...claimed], ttlSeconds);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    stores.logger.warn(
      `dedup cache warm failed for ${claimed.size} keys: ${reason}`,
    );
  }
}

/** `(k1, k2, …)` body for a `dedup_key IN (…)` filter. */
function inList(keys: readonly string[]): SQL {
  return sql.join(keys.map((k) => sql`${k}`), sql`, `);
}

/** The keys among `keys` with a non-expired DB row — ONE query. */
async function findValidDbKeys(
  db: DedupBatchStores['db'],
  keys: readonly string[],
): Promise<Set<string>> {
  const rows = await db.execute<{ dedup_key: string }>(sql`
    SELECT dedup_key FROM notification_dedup
    WHERE dedup_key IN (${inList(keys)})
      AND (expires_at IS NULL OR expires_at > NOW())
  `);
  return new Set(Array.from(rows, (r) => r.dedup_key));
}

/**
 * Drop the keys' expired rows, then insert every key with
 * `ON CONFLICT DO NOTHING` — exactly `attemptInsert`, batched.
 *
 * @returns The keys whose insert won (a concurrent claimer's are absent).
 */
async function insertClaims(
  db: DedupBatchStores['db'],
  keys: readonly string[],
  ttlSeconds: number | null,
): Promise<Set<string>> {
  await db.execute(sql`
    DELETE FROM notification_dedup
    WHERE dedup_key IN (${inList(keys)})
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
  `);
  const expiresAt =
    ttlSeconds != null
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;
  const values = keys.map((k) => sql`(${k}, ${expiresAt})`);
  const won = await db.execute<{ dedup_key: string }>(sql`
    INSERT INTO notification_dedup (dedup_key, expires_at)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING dedup_key
  `);
  return new Set(Array.from(won, (r) => r.dedup_key));
}

/** Set every key in Redis in one pipeline, as `warmRedisCache` does per key. */
async function warmKeys(
  redis: DedupBatchStores['redis'],
  keys: readonly string[],
  ttlSeconds: number | null,
): Promise<void> {
  if (keys.length === 0) return;
  const pipeline = redis.pipeline();
  for (const key of keys) {
    if (ttlSeconds != null) pipeline.set(key, '1', 'EX', ttlSeconds);
    else pipeline.set(key, '1');
  }
  await pipeline.exec();
}
