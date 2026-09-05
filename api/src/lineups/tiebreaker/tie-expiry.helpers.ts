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
import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

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
  /** Where a per-lineup failure is reported; the sweep never throws for one. */
  logger?: { warn: (message: string) => void };
}

/** Ids the sweep moved to the expired/archived terminal state. */
export interface TieExpirySweepResult {
  expired: number[];
}

/** The predicate every sweep write shares: an OPEN hold nobody is acting on. */
function expiredHoldPredicate(now: Date) {
  return and(
    eq(schema.communityLineups.status, 'voting'),
    isNotNull(schema.communityLineups.tieDetectedAt),
    isNull(schema.communityLineups.tieExpiredAt),
    // Not awaiting a human: a running bracket/veto (the D15 opt-in) or a pick
    // whose grace advance has not fired yet OWNS the outcome — archiving
    // underneath either would throw away a decision in flight.
    isNull(schema.communityLineups.activeTiebreakerId),
    // A pick owns the outcome only while its grace claim is live; a pick
    // whose advance never fired (claim released) must not disable the
    // week-long backstop for good.
    or(
      isNull(schema.communityLineups.tiePickAt),
      isNull(schema.communityLineups.pendingAdvanceAt),
    ),
    lte(schema.communityLineups.tieExpiresAt, now),
  );
}

/**
 * Candidate holds: still in `voting`, hold open, nobody acting on it, and
 * past `tie_expires_at`. The same predicate guards the archive UPDATE, so the
 * scan is advisory and the write is what decides.
 */
export async function findExpiredTieHolds(
  db: Db,
  now: Date,
): Promise<number[]> {
  const rows = await db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(expiredHoldPredicate(now));
  return rows.map((r) => r.id);
}

/**
 * Archive one expired hold: `status → archived` and `tie_expired_at` stamped
 * in ONE conditional UPDATE, so there is exactly one edge and never a
 * half-written row. Returns true only for the caller whose statement matched;
 * a concurrent sweep, or a lineup that a grace advance moved to `decided`
 * between the candidate scan and this write, gets false and changed nothing.
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
    .set({ status: 'archived', tieExpiredAt: now, updatedAt: now })
    .where(
      and(eq(schema.communityLineups.id, lineupId), expiredHoldPredicate(now)),
    )
    .returning({ id: schema.communityLineups.id });
  return rows.length === 1;
}

/**
 * Expire every hold whose week has run out.
 *
 * `archiveExpiredTieHold` is the edge: it only returns true for the caller
 * that actually flipped the row, so a second sweep (or a second replica)
 * archives nothing and the returned list stays the single, once-only trigger
 * the notification wiring keys off. One lineup's failure is logged and
 * skipped — the holds already archived keep their place in the list, and the
 * failed one is still an open hold the next sweep picks up again.
 */
export async function sweepExpiredTieHolds(
  db: Db,
  now: Date = new Date(),
  deps: TieExpiryDeps = {},
): Promise<TieExpirySweepResult> {
  const candidates = await findExpiredTieHolds(db, now);
  const expired: number[] = [];
  for (const lineupId of candidates) {
    try {
      if (!(await archiveExpiredTieHold(db, lineupId, now))) continue;
      await logExpirySafely(deps, lineupId);
      expired.push(lineupId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        `Tie expiry sweep failed for lineup ${lineupId}: ${msg}`,
      );
    }
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
