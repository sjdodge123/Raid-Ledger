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
import type {
  LfgIntentDto,
  LfgIntentStatus,
  LfgNowTtl,
  LfgUrgency,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { convertedToTarget } from './lfg-provenance.helpers';
import {
  LFG_DEFAULT_NOW_TTL_MINUTES,
  LFG_DEFAULT_VISIBILITY,
  computeExpiresAt,
  computeNowExpiresAt,
} from './lfg.constants';

export type LfgIntentRow = typeof schema.lfgIntents.$inferSelect;

/**
 * The urgency class a write is being asked for.
 *
 * `ttlMinutes` is meaningful only alongside `urgency: 'now'`; the contract's
 * `CreateLfgIntentSchema` already rejects the pairing with `'week'` (A2), so
 * this type never has to defend against it.
 */
export interface LfgUrgencyRequest {
  urgency: LfgUrgency;
  ttlMinutes?: LfgNowTtl | null;
}

/** The default every pre-ROK-1479 caller gets: an unchanged 14-day intent. */
const WEEK_REQUEST: LfgUrgencyRequest = { urgency: 'week' };

/** The three columns a class determines, resolved together so they can't drift. */
interface LfgIntentHorizon {
  urgency: LfgUrgency;
  ttlMinutes: number | null;
  expiresAt: Date;
}

/**
 * Resolve a requested class into the exact columns a write commits.
 *
 * The single place either horizon is chosen — `insertIntent`, `reviveIntent`
 * and `bumpIntentUrgency` all go through it, so "what does `now` mean" cannot
 * disagree between the create path and the bump path.
 *
 * @param opts - Requested class; an absent `ttlMinutes` on `now` means 30.
 * @param from - Instant to measure the horizon from. Defaults to now.
 */
export function resolveIntentHorizon(
  opts: LfgUrgencyRequest,
  from: Date = new Date(),
): LfgIntentHorizon {
  if (opts.urgency === 'now') {
    const ttlMinutes = opts.ttlMinutes ?? LFG_DEFAULT_NOW_TTL_MINUTES;
    return {
      urgency: 'now',
      ttlMinutes,
      expiresAt: computeNowExpiresAt(ttlMinutes, from),
    };
  }
  return {
    urgency: 'week',
    ttlMinutes: null,
    expiresAt: computeExpiresAt(from),
  };
}

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
export function liveGroupRow(db: LfgDb, gameId: number, now: Date) {
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
    urgency: row.urgency as LfgUrgency,
    ttlMinutes: row.ttlMinutes,
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
 * @param opts - Requested urgency class. Defaults to the pre-ROK-1479 week.
 * @returns The new row, or null when the partial unique index rejected it.
 */
export async function insertIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
  opts: LfgUrgencyRequest = WEEK_REQUEST,
): Promise<LfgIntentRow | null> {
  const [row] = await db
    .insert(schema.lfgIntents)
    .values({
      userId,
      gameId,
      status: 'active',
      visibility: LFG_DEFAULT_VISIBILITY,
      ...resolveIntentHorizon(opts),
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
 * Revives on the REQUESTED class, not the one the dead row happened to hold:
 * re-hearting an expired weekly intent as "right now" must produce a now-row.
 *
 * @param intentId - Row to push forward.
 * @param opts - Requested urgency class. Defaults to the pre-ROK-1479 week.
 */
export async function reviveIntent(
  db: LfgDb,
  intentId: number,
  opts: LfgUrgencyRequest = WEEK_REQUEST,
): Promise<LfgIntentRow> {
  const [row] = await db
    .update(schema.lfgIntents)
    .set(resolveIntentHorizon(opts))
    .where(eq(schema.lfgIntents.id, intentId))
    .returning();
  return row;
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

/** What one hourly sweep touched. */
export interface LfgExpirySweep {
  /** Rows flipped to `expired` — what the sweep logs. */
  count: number;
  /** The DISTINCT games those rows belonged to — what the sweep emits for. */
  gameIds: number[];
}

/**
 * Hourly sweep: flip past-expiry rows to `expired`. Bookkeeping only — reads
 * already filter on `expires_at`.
 *
 * Reports the games as well as the count because this sweep is the ONLY thing
 * that knows a group died of old age (ROK-1454 D2), and it used to throw that
 * away. De-duplicated by game so a 40-row sweep across 3 games costs three
 * downstream edits rather than forty (E10). Insertion order is preserved.
 *
 * @param db - Drizzle handle.
 * @returns How many rows expired, and which distinct games they belonged to.
 */
export async function expireStaleIntents(db: LfgDb): Promise<LfgExpirySweep> {
  const rows = await db
    .update(schema.lfgIntents)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.lfgIntents.status, 'active'),
        lte(schema.lfgIntents.expiresAt, new Date()),
      ),
    )
    .returning({
      id: schema.lfgIntents.id,
      gameId: schema.lfgIntents.gameId,
    });
  return {
    count: rows.length,
    gameIds: [...new Set(rows.map((row) => row.gameId))],
  };
}
