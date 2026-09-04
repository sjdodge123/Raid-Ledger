/**
 * Write-side helpers for LFG intents (ROK-1451).
 *
 * The partial unique index `(user_id, game_id) WHERE status = 'active'` is the
 * concurrency guard. Creates go through `ON CONFLICT DO NOTHING` + re-select —
 * NEVER catch a unique violation, because under postgres.js a failed statement
 * poisons the whole transaction, savepoints included (memory
 * `reference_postgres_savepoint_does_not_contain_violations`).
 */
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { LfgIntentDto, LfgIntentStatus } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { convertedToTarget } from './lfg-provenance.helpers';
import { LFG_DEFAULT_VISIBILITY, computeExpiresAt } from './lfg.constants';

export type LfgIntentRow = typeof schema.lfgIntents.$inferSelect;

/** Provenance recorded when a group converts. Exactly one field is set. */
export interface LfgConversionTarget {
  pollId?: number;
  eventId?: number;
}

/**
 * Sub-select of holders a read would still count: neither deactivated nor
 * banned (ROK-313 guard family).
 */
function eligibleHolderIds(db: LfgDb) {
  return db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(isNull(schema.users.deactivatedAt), isNull(schema.users.bannedAt)),
    );
}

/**
 * The read-side liveness predicate, applied to a WRITE (H1 / Codex P1-a+P2-a).
 *
 * `status = 'active'` alone matches rows the cron has not swept yet and rows
 * held by a departed player — neither appears in any read, so neither may be
 * refreshed or converted by somebody else's action.
 *
 * @param db - Drizzle handle (the sub-select must run on the same connection).
 * @param gameId - Game whose group is being written.
 * @param now - Instant the liveness check is measured against.
 */
function liveGroupRow(db: LfgDb, gameId: number, now: Date) {
  return and(
    eq(schema.lfgIntents.gameId, gameId),
    eq(schema.lfgIntents.status, 'active'),
    gt(schema.lfgIntents.expiresAt, now),
    inArray(schema.lfgIntents.userId, eligibleHolderIds(db)),
  );
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
 * The +1 refresh (AC5): push `expires_at` out for every LIVE intent on the
 * game, the brand-new row included.
 *
 * Eligibility is the read-side predicate, not just `status = 'active'`: a
 * lapsed-but-unswept row (or a departed holder's row) must NOT be pushed 14
 * days forward, because that re-raises a hand the player never raised (AC15).
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group clock resets.
 */
export async function refreshGroupExpiry(
  db: LfgDb,
  gameId: number,
): Promise<void> {
  const now = new Date();
  await db
    .update(schema.lfgIntents)
    .set({ expiresAt: computeExpiresAt(now) })
    .where(liveGroupRow(db, gameId, now));
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
 * Conversion (AC8): flip every LIVE intent on the game to `converted` and
 * record the provenance. Idempotent — a second call converts zero rows.
 *
 * Uses the read-side liveness predicate so provenance can never name a player
 * the visible group had already dropped (Codex P2-a).
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
    .where(liveGroupRow(db, gameId, new Date()))
    .returning({ id: schema.lfgIntents.id });
  return rows.length;
}

/**
 * True when the caller may convert this game's group RIGHT NOW.
 *
 * Two ways to qualify:
 *   1. They hold a live active intent on the game — an actual member.
 *   2. Their row already converted into *this exact target*, which is a
 *      retry of their own call and must stay idempotent rather than 403.
 *
 * A `converted` row pointing at some OTHER poll/event is a past group and
 * grants nothing: without (2)'s target correlation, an old participant could
 * convert a later group they were never part of (Codex P1-b).
 *
 * @param db - Drizzle handle.
 * @param userId - Caller.
 * @param gameId - Game to check.
 * @param target - The conversion target from the request.
 */
export async function isGroupParticipant(
  db: LfgDb,
  userId: number,
  gameId: number,
  target: LfgConversionTarget,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        or(
          and(
            eq(schema.lfgIntents.status, 'active'),
            gt(schema.lfgIntents.expiresAt, new Date()),
          ),
          and(
            eq(schema.lfgIntents.status, 'converted'),
            convertedToTarget(target),
          ),
        ),
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
