/**
 * Write-side helpers for LFG intents (ROK-1451).
 *
 * The partial unique index `(user_id, game_id) WHERE status = 'active'` is the
 * concurrency guard. Creates go through `ON CONFLICT DO NOTHING` + re-select —
 * NEVER catch a unique violation, because under postgres.js a failed statement
 * poisons the whole transaction, savepoints included (memory
 * `reference_postgres_savepoint_does_not_contain_violations`).
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { LfgIntentDto, LfgIntentStatus } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_DEFAULT_VISIBILITY, computeExpiresAt } from './lfg.constants';

export type LfgIntentRow = typeof schema.lfgIntents.$inferSelect;

/** Provenance recorded when a group converts. Exactly one field is set. */
export interface LfgConversionTarget {
  pollId?: number;
  eventId?: number;
}

/** Project a stored row onto the wire DTO. */
export function toIntentDto(row: LfgIntentRow): LfgIntentDto {
  return {
    id: row.id,
    userId: row.userId,
    gameId: row.gameId,
    status: row.status as LfgIntentStatus,
    visibility: row.visibility as LfgIntentDto['visibility'],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    convertedToPollId: row.convertedToPollId,
    convertedToEventId: row.convertedToEventId,
  };
}

/**
 * Insert a fresh intent, yielding null when an active row already exists.
 *
 * @param db - Drizzle handle.
 * @param userId - Intent holder.
 * @param gameId - Game the holder wants to play.
 * @returns The new row, or null when the partial unique index rejected it.
 */
export async function insertIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
): Promise<LfgIntentRow | null> {
  const [row] = await db
    .insert(schema.lfgIntents)
    .values({
      userId,
      gameId,
      status: 'active',
      visibility: LFG_DEFAULT_VISIBILITY,
      expiresAt: computeExpiresAt(),
    })
    .onConflictDoNothing({
      target: [schema.lfgIntents.userId, schema.lfgIntents.gameId],
      where: sql`status = 'active'`,
    })
    .returning();
  return row ?? null;
}

/**
 * Read the caller's `status = 'active'` row for a game, expired or not.
 *
 * @param db - Drizzle handle.
 * @param userId - Intent holder.
 * @param gameId - Game to look up.
 */
export async function findActiveIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
): Promise<LfgIntentRow | null> {
  const [row] = await db
    .select()
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Revive a stale-but-still-`active` row in place — never insert a duplicate.
 *
 * @param db - Drizzle handle.
 * @param intentId - Row to push forward.
 */
export async function reviveIntent(
  db: LfgDb,
  intentId: number,
): Promise<LfgIntentRow> {
  const [row] = await db
    .update(schema.lfgIntents)
    .set({ expiresAt: computeExpiresAt() })
    .where(eq(schema.lfgIntents.id, intentId))
    .returning();
  return row;
}

/**
 * The +1 refresh (AC5): push `expires_at` out for EVERY active intent on the
 * game, the brand-new row included.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group clock resets.
 */
export async function refreshGroupExpiry(
  db: LfgDb,
  gameId: number,
): Promise<void> {
  await db
    .update(schema.lfgIntents)
    .set({ expiresAt: computeExpiresAt() })
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
      ),
    );
}

/**
 * Withdraw: flip the caller's active row to `cleared`. Never touches anyone
 * else's row.
 *
 * @param db - Drizzle handle.
 * @param userId - Intent holder.
 * @param gameId - Game to withdraw from.
 * @returns True when a row was cleared, false when the caller held none.
 */
export async function clearIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({ status: 'cleared' })
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length > 0;
}

/**
 * Conversion (AC8): flip every active intent on the game to `converted` and
 * record the provenance. Idempotent — a second call converts zero rows.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group converted.
 * @param target - Exactly one of `pollId` / `eventId`.
 * @returns How many rows converted.
 */
export async function convertGroup(
  db: LfgDb,
  gameId: number,
  target: LfgConversionTarget,
): Promise<number> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({
      status: 'converted',
      convertedToPollId: target.pollId ?? null,
      convertedToEventId: target.eventId ?? null,
    })
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}

/**
 * True when the caller took part in this game's group — an active row, or one
 * already converted (so a second convert is idempotent rather than a 403).
 *
 * @param db - Drizzle handle.
 * @param userId - Caller.
 * @param gameId - Game to check.
 */
export async function isGroupParticipant(
  db: LfgDb,
  userId: number,
  gameId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        inArray(schema.lfgIntents.status, ['active', 'converted']),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Hourly sweep: flip past-expiry rows to `expired`. Bookkeeping only — reads
 * already filter on `expires_at`.
 *
 * @param db - Drizzle handle.
 * @returns How many rows expired.
 */
export async function expireStaleIntents(db: LfgDb): Promise<number> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.lfgIntents.status, 'active'),
        lte(schema.lfgIntents.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}
