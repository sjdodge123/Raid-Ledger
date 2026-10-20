/**
 * ROK-1431 — the reconcile's narrow DB writes (spec ROK-1428 §2.5, D9).
 *
 * Bindings are only ever CREATED through `ChannelBindingsService.bind()`;
 * this file owns the lifecycle state columns, the suppression rows and the
 * single-flight lock shared by the cron, the admin route and the nudge.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import type { ChannelLifecycleSuppressionReason } from '../../drizzle/schema/channel-lifecycle-suppressions';

/**
 * The app's Drizzle handle — the pool OR a transaction on it (a game's
 * per-game `tx`), so every query for that game runs on its connection.
 */
export type LifecycleDb = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** The lifecycle columns a reconcile writes on a managed binding. */
export interface LifecycleStatePatch {
  lifecycleState?: 'active' | 'archived';
  autoManaged?: boolean;
  archivedAt?: Date | null;
  restoreParentId?: string | null;
  archivedOverwrites?: ArchivedOverwrites | null;
}

/** The slice of a deleted binding row the unbind hook reads. */
export interface UnboundBindingRow {
  guildId: string;
  gameId: number | null;
  autoManaged: boolean;
  recurrenceGroupId: string | null;
  bindingPurpose: string;
}

/** Write lifecycle state columns on one binding (never routing columns). */
export async function setLifecycleState(
  db: LifecycleDb,
  bindingId: string,
  patch: LifecycleStatePatch,
): Promise<void> {
  await db
    .update(schema.channelBindings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.channelBindings.id, bindingId));
}

/**
 * Record that a game's managed channel must not be recreated (D9). An
 * existing row is kept, so a `deleted` written first survives the unbind hook.
 */
export async function insertSuppression(
  db: LifecycleDb,
  row: {
    guildId: string;
    gameId: number;
    reason: ChannelLifecycleSuppressionReason;
  },
): Promise<void> {
  await db
    .insert(schema.channelLifecycleSuppressions)
    .values(row)
    .onConflictDoNothing();
}

/** Clear a game's suppression ("Recreate"); true when a row was removed. */
export async function deleteSuppression(
  db: LifecycleDb,
  guildId: string,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .delete(schema.channelLifecycleSuppressions)
    .where(
      and(
        eq(schema.channelLifecycleSuppressions.guildId, guildId),
        eq(schema.channelLifecycleSuppressions.gameId, gameId),
      ),
    )
    .returning({ id: schema.channelLifecycleSuppressions.id });
  return rows.length > 0;
}

/**
 * Unbind hook (D9): an admin removing an auto-managed game binding stops the
 * lifecycle managing that game — suppress it with reason `unbound`.
 */
export async function suppressUnboundAutoBindings(
  db: LifecycleDb,
  rows: readonly UnboundBindingRow[],
): Promise<void> {
  for (const row of rows) {
    if (!row.autoManaged || row.gameId === null) continue;
    if (row.recurrenceGroupId !== null) continue;
    if (row.bindingPurpose !== 'game-announcements') continue;
    await insertSuppression(db, {
      guildId: row.guildId,
      gameId: row.gameId,
      reason: 'unbound',
    });
  }
}

/** Outcome of `withReconcileLock`. */
export type LockedRun<T> = { acquired: true; value: T } | { acquired: false };

/** The slice of the app's Redis client the reconcile lease uses. */
export type LeaseRedis = Pick<Redis, 'set' | 'eval'>;

/** The single-flight lease key shared by the cron, the admin route and the nudge. */
export const RECONCILE_LEASE_KEY = 'channel-lifecycle:reconcile-lease';

/** Lease expiry: far above a tick's length, so only a crashed holder's lease lapses. */
export const RECONCILE_LEASE_MS = 30 * 60_000;

/** Delete the lease only while it is still ours (an expired one may be re-held). */
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

/**
 * Single-flight (spec §2.3, Codex r4b P1): run `fn` while holding a Redis
 * lease (`SET NX PX`); a concurrent caller gets `{acquired: false}` at once.
 * The lease holds NO database connection, so `fn` commits each game in its
 * own transaction on the pool (one at a time — a `DB_POOL_MAX=1` pool never
 * needs a second connection) and a later game's failed write cannot roll
 * back an earlier game's state. A failed release just lets the lease expire.
 */
export async function withReconcileLock<T>(
  redis: LeaseRedis,
  fn: () => Promise<T>,
): Promise<LockedRun<T>> {
  const token = randomUUID();
  const ok = await redis.set(
    RECONCILE_LEASE_KEY,
    token,
    'PX',
    RECONCILE_LEASE_MS,
    'NX',
  );
  if (ok !== 'OK') return { acquired: false };
  try {
    return { acquired: true, value: await fn() };
  } finally {
    await redis.eval(RELEASE_LUA, 1, RECONCILE_LEASE_KEY, token).catch(() => 0);
  }
}
