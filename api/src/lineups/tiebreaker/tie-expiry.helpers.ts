/**
 * ROK-1374 — the tie-hold expiry sweep (D13, E12, AC18).
 *
 * "Nobody picks → expire after the intended voting period + ONE WEEK" is an
 * operator answer, and so is the sentence right after it: expiry NEVER picks a
 * winner. This file therefore archives and stamps, and issues no UPDATE that
 * can carry `decidedGameId`. A lineup that sat in `voting` for a week past its
 * deadline with a completed vote and no human pick did not decide anything;
 * archiving says so out loud, where leaving it in `voting` forever is the same
 * dead-end in slower motion.
 *
 * The archive is a direct conditional UPDATE rather than `runStatusTransition`
 * on purpose: `VALID_TRANSITIONS` (`lineups-query.helpers.ts:186`) maps
 * `voting → decided`, so voting → archived is not a forward transition, and
 * the only existing writer of this shape is the operator force-archive
 * (`lineups-abort.helpers.ts:118`), which needs a human actor and a reason.
 * Guarding the UPDATE on `status = 'voting'` keeps the CAS property that path
 * relies on without borrowing its DTO.
 */
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { expireTieHold } from './tie-hold.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** SchedulerRegistry name; must match the `CORE_JOB_METADATA` key. */
export const TIE_EXPIRY_JOB_NAME = 'TieExpiryService_expireTieHolds';

/**
 * Daily at 05:40 UTC. Daily (not hourly, as LFG expiry is) because the window
 * is a week wide — a few hours of lag cannot mislead anyone, and the sweep
 * fans out DMs, which is not something to repeat 24× a day.
 */
export const TIE_EXPIRY_CRON_EXPRESSION = '0 40 5 * * *';

/** Side-effects the sweep delegates rather than owning. */
export interface TieExpiryDeps {
  /**
   * Records the terminal state on the lineup's activity timeline. Optional so
   * the helper stays unit-testable without the Nest container; failures are
   * swallowed per-lineup — an audit row is not worth abandoning the sweep.
   */
  logExpiry?: (lineupId: number) => Promise<void>;
}

/** Ids the sweep moved to the expired/archived terminal state. */
export interface TieExpirySweepResult {
  expired: number[];
}

/**
 * Candidate holds: still in `voting`, hold open, and past `tie_expires_at`.
 *
 * `tie_expired_at IS NULL` is part of the predicate as well as of
 * `expireTieHold`'s guard — here it keeps the scan small, there it is what
 * makes the sweep idempotent under concurrency.
 */
export async function findExpiredTieHolds(
  db: Db,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(
      and(
        eq(schema.communityLineups.status, 'voting'),
        isNotNull(schema.communityLineups.tieDetectedAt),
        isNull(schema.communityLineups.tieExpiredAt),
        lte(schema.communityLineups.tieExpiresAt, now),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Flip an expired hold's lineup to `archived`, guarded on it still being in
 * `voting`. Returns true when this call did the flip.
 *
 * The payload is deliberately three keys wide. Anything that resolves the tie
 * belongs to a human-initiated path (AC16), and this one has no actor.
 */
export async function archiveExpiredTieHold(
  db: Db,
  lineupId: number,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: now })
    .where(
      and(
        eq(schema.communityLineups.id, lineupId),
        eq(schema.communityLineups.status, 'voting'),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return rows.length === 1;
}

/**
 * Expire every hold whose week has run out.
 *
 * `expireTieHold` is the edge: it only returns true for the caller that
 * actually stamped `tie_expired_at`, so a second sweep (or a second replica)
 * archives nothing and the returned list stays the single, once-only trigger
 * the notification wiring keys off.
 */
export async function sweepExpiredTieHolds(
  db: Db,
  now: Date = new Date(),
  deps: TieExpiryDeps = {},
): Promise<TieExpirySweepResult> {
  const candidates = await findExpiredTieHolds(db, now);
  const expired: number[] = [];
  for (const lineupId of candidates) {
    if (!(await expireTieHold(db, lineupId, now))) continue;
    await archiveExpiredTieHold(db, lineupId, now);
    await logExpirySafely(deps, lineupId);
    expired.push(lineupId);
  }
  return { expired };
}

/** One lineup's audit row must never cost the rest of the sweep. */
async function logExpirySafely(
  deps: TieExpiryDeps,
  lineupId: number,
): Promise<void> {
  if (!deps.logExpiry) return;
  try {
    await deps.logExpiry(lineupId);
  } catch {
    // Swallowed by design: the row state is the source of truth, the
    // timeline entry is decoration. Re-throwing would strand later holds.
  }
}
