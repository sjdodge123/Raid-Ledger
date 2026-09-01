/**
 * ROK-1444 — count-based early advance for the building phase.
 *
 * Opens voting once nominations reach `nomination_target_pct` of the dynamic
 * nomination cap, instead of idling until `phase_deadline`. Lives inside the
 * building-quorum predicate on purpose: routed that way it inherits the
 * ROK-1253 revert pause, the grace window, the activity logging and the single
 * `runStatusTransition` path for free. A parallel advance trigger would have to
 * re-derive all four, and that is exactly where the revert trap comes back.
 *
 * ## The revert trap, and why two columns are needed
 *
 * Scenario: 20 games nominated, lineup advances to voting. Someone new joins,
 * the group wants different games, the operator reverts voting -> building. The
 * count condition is STILL TRUE the instant the revert lands, so a naive target
 * re-advances immediately and the lineup can never be edited. Livelock.
 *
 * ROK-1253 solved the same shape for the submission quorum with a TTL'd pause,
 * and ROK-1296 then found the pause ALONE was insufficient — it also had to
 * clear the `*_submitted_at` stamps, because (per `lineups-revert.helpers.ts`)
 * "the pause TTL only buys time". That second half has no analogue here: the 20
 * nominations cannot be cleared, they are the very thing the operator reverted
 * in order to edit. The condition is inherently non-clearable.
 *
 * Firing only on the rising edge is necessary but also insufficient on its own:
 * after reverting, the operator deletes a weak game (20 -> 19) and adds a better
 * one (19 -> 20) — that IS a rising edge, and the lineup would advance out from
 * under them mid-edit.
 *
 * So the guard is all three:
 *   1. Rising edge only    — `nomination_target_below_seen_at` must be set,
 *                            i.e. the lineup was OBSERVED below target while
 *                            armed. Never fires on a standing condition.
 *   2. Respects the pause  — inherited from `maybeAutoAdvance`'s `isPauseActive`
 *                            short-circuit, because we run inside it.
 *   3. Sticky, not TTL'd   — `nomination_target_disarmed_at` is stamped on
 *                            `voting -> building` and NEVER auto-cleared, so a
 *                            reverted lineup stays manually controlled.
 *
 * ## Moving denominator
 *
 * The cap is `max(20, distinctNominators * 5)`, so it GROWS as people join: a
 * fifth nominator takes it 20 -> 25 and a 50% target from 10 games to 13. The
 * condition can therefore flip false purely because someone joined, with no
 * nomination change — which is also why the rising edge is persisted rather
 * than inferred from a `count - 1` delta the way `checkNominationMilestone`
 * does. That trick is only sound when the denominator is fixed.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  loadEffectiveNominationCap,
  loadEffectiveNominationCapById,
} from '../lineups-nomination-cap.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** Mirror of `QuorumResult` — kept local so this module stays dependency-light. */
export interface NominationTargetResult {
  ready: boolean;
  reason?: string;
}

/** Percentage of the cap currently filled, clamped against a zero cap. */
export function nominationTargetPercent(
  entryCount: number,
  cap: number,
): number {
  if (cap <= 0) return 0;
  return (entryCount / cap) * 100;
}

/**
 * Count-target branch of the building quorum.
 *
 * Returns `ready: true` only when every guard above passes. `floor` is the
 * global `LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS` and stays an absolute minimum on
 * top of the percentage, so a low target cannot advance a near-empty lineup.
 */
export async function evaluateNominationTarget(
  db: Db,
  lineup: LineupRow,
  entryCount: number,
  floor: number,
): Promise<NominationTargetResult> {
  const target = lineup.nominationTargetPct ?? null;
  if (target === null) {
    return { ready: false, reason: 'no nomination target configured' };
  }
  // Guard 3 (sticky disarm) runs FIRST so a reverted lineup performs no writes
  // and cannot re-arm itself by dipping below the target during an edit.
  if (lineup.nominationTargetDisarmedAt != null) {
    return {
      ready: false,
      reason: 'nomination target disarmed by an earlier revert to building',
    };
  }

  const cap = await loadEffectiveNominationCap(db, lineup);
  const pct = nominationTargetPercent(entryCount, cap);

  if (pct < target) {
    // Below target: arm the rising edge so a later crossing may fire.
    await armNominationTarget(db, lineup);
    return {
      ready: false,
      reason: `nomination target not met (${entryCount}/${cap} = ${Math.floor(pct)}% of ${target}%)`,
    };
  }
  // Guard 1 (rising edge): at or above target, but this lineup has never been
  // observed below it while armed — a standing condition, not a crossing.
  // Reached by a carry-over-seeded lineup that started above target.
  if (lineup.nominationTargetBelowSeenAt == null) {
    return {
      ready: false,
      reason:
        'nomination target was already satisfied before arming; no rising edge',
    };
  }
  if (entryCount < floor) {
    return {
      ready: false,
      reason: `nomination floor not met (${entryCount}/${floor})`,
    };
  }
  return { ready: true };
}

/**
 * Stamp the rising-edge arm the first time the target is seen unmet.
 *
 * Opportunistic write from inside a predicate, mirroring `isPauseActive`'s lazy
 * pause clear. Guarded on the in-memory snapshot AND on `IS NULL` in the WHERE
 * so concurrent nominators cannot clobber an earlier arm.
 */
async function armNominationTarget(db: Db, lineup: LineupRow): Promise<void> {
  if (lineup.nominationTargetBelowSeenAt != null) return;
  await db
    .update(schema.communityLineups)
    .set({ nominationTargetBelowSeenAt: new Date() })
    .where(
      and(
        eq(schema.communityLineups.id, lineup.id),
        isNull(schema.communityLineups.nominationTargetBelowSeenAt),
      ),
    );
}

/**
 * Arm a freshly-created lineup (called after carry-over has seeded entries).
 *
 * Without this, a target low enough to already be met at the very first
 * nomination (e.g. 5% of a 20-cap = 1 game) would never observe itself below
 * target and so could never fire. Leaving the stamp NULL for a lineup that
 * starts at or above target is the intended outcome: it advances by deadline.
 */
export async function armNominationTargetOnCreate(
  db: Db,
  lineup: LineupRow,
): Promise<void> {
  const target = lineup.nominationTargetPct ?? null;
  if (target === null) return;
  const rows = await db
    .select({ id: schema.communityLineupEntries.id })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineup.id));
  // Read the cap fresh from the id, not from `lineup`: this runs at creation
  // with the PRE-carry-over row, whose `nominationCapPeak` is still null.
  // `carryOverFromLastDecided` has since pinned it, and that — not this — is
  // the ratchet point, or a deadline-only lineup (target null, early-returned
  // above) would never pin at all.
  const cap = await loadEffectiveNominationCapById(db, lineup.id);
  if (nominationTargetPercent(rows.length, cap) < target) {
    await armNominationTarget(db, lineup);
  }
}
