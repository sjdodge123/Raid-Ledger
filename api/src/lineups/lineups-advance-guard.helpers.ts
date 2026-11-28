/**
 * ROK-1710 (Codex P2): pin an automatic `building -> voting` advance to the
 * target state it judged.
 *
 * `maybeAutoAdvance` (grace 0) and the grace worker judge quorum on a row
 * snapshot, then write the transition later. A nomination-target edit can
 * commit in between — raising or turning off the target, and clearing the
 * grace claim. The transition's conditional UPDATE therefore also requires
 * the target, its disarm stamp and the grace claim it judged; an edit that
 * landed first changes at least one of them, so the stale advance matches no
 * row and fails as a concurrent change (both callers swallow that). Postgres
 * re-checks the WHERE after waiting on the edit's row lock, so this holds
 * even when the two overlap. No new column: the edit already rewrites these.
 *
 * The rising-edge arm stamp is pinned too (Codex round 4): an edit sequence
 * that ends on the judged pct (50 -> 75 -> 50) restores pct, disarm and claim
 * but always rewrites or clears `nomination_target_below_seen_at`, so the arm
 * the evaluation saw is the one value an ABA edit cannot put back.
 */
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type LineupRow = typeof schema.communityLineups.$inferSelect;

/** The target state an automatic advance was judged under. */
export interface AdvanceGuard {
  nominationTargetPct: number | null;
  nominationTargetDisarmedAt: Date | null;
  pendingAdvanceAt: Date | null;
  /** Rising-edge arm stamp the evaluation saw (null = unarmed). */
  nominationTargetBelowSeenAt: Date | null;
}

/**
 * The guard for an automatic advance judged on `lineup`. Only `building`
 * carries one: the target is a nominating-phase setting, and `voting ->
 * decided` keeps its status-only predicate unchanged.
 */
export function advanceGuardFrom(
  lineup: Pick<
    LineupRow,
    | 'status'
    | 'nominationTargetPct'
    | 'nominationTargetDisarmedAt'
    | 'pendingAdvanceAt'
    | 'nominationTargetBelowSeenAt'
  >,
): AdvanceGuard | undefined {
  if (lineup.status !== 'building') return undefined;
  return {
    nominationTargetPct: lineup.nominationTargetPct ?? null,
    nominationTargetDisarmedAt: lineup.nominationTargetDisarmedAt ?? null,
    pendingAdvanceAt: lineup.pendingAdvanceAt ?? null,
    nominationTargetBelowSeenAt: lineup.nominationTargetBelowSeenAt ?? null,
  };
}

/**
 * WHERE fragment: the row still holds exactly the judged target state.
 *
 * The arm stamp is matched only when the evaluation saw one. A building
 * advance is never ready without an arm: `checkBuildingQuorum` has no ready
 * path other than the target, and the target refuses an unarmed row (rising
 * edge). When `armNominationTarget` stamps during an evaluation, that same
 * evaluation returns `ready: false`. So a null snapshot never reaches a
 * building advance, and leaving the stamp unconstrained for it is only
 * tolerance: it keeps a null-stamp guard harmless. Matching `IS NULL` there
 * would be equivalent.
 */
export function advanceGuardCondition(guard: AdvanceGuard): SQL | undefined {
  const c = schema.communityLineups;
  return and(
    guard.nominationTargetPct === null
      ? isNull(c.nominationTargetPct)
      : eq(c.nominationTargetPct, guard.nominationTargetPct),
    guard.nominationTargetDisarmedAt === null
      ? isNull(c.nominationTargetDisarmedAt)
      : eq(c.nominationTargetDisarmedAt, guard.nominationTargetDisarmedAt),
    guard.pendingAdvanceAt === null
      ? isNull(c.pendingAdvanceAt)
      : eq(c.pendingAdvanceAt, guard.pendingAdvanceAt),
    guard.nominationTargetBelowSeenAt === null
      ? undefined
      : eq(c.nominationTargetBelowSeenAt, guard.nominationTargetBelowSeenAt),
  );
}
