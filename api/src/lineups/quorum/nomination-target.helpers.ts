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
 *                            reverted lineup stays manually controlled. Only an
 *                            explicit target edit clears it (ROK-1710,
 *                            `applyNominationTargetEdit`), and that edit re-runs
 *                            the create-time arm check, so a standing condition
 *                            still cannot fire.
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
import { ConflictException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  loadEffectiveNominationCap,
  loadEffectiveNominationCapById,
} from '../lineups-nomination-cap.helpers';

type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle: the metadata edit runs the target edit inside one. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | Tx;
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
    await armNominationTarget(db, lineup, target);
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
 * pause clear. Guarded on the in-memory snapshot AND in the WHERE (see
 * `stampBelowSeen`) so a stale snapshot cannot arm the lineup. The snapshot's
 * `updated_at` is passed through so an edit that landed after the read voids
 * the write even when it restored the judged pct (Codex round 5).
 *
 * A refused pinned write falls back to the create/edit arm check, which
 * recounts the entries and re-reads the cap: any `updated_at` bump in the
 * read-to-write window (a title edit, a share toggle, a deadline extension)
 * would otherwise drop a legitimate arm, and if the next nomination crosses
 * the target that crossing has no rising edge and never fires. The recount
 * keeps the round-5 guarantee: after 75 -> 50 -> 75 the live count is what the
 * last edit judged, so the fallback arms exactly when that edit would have.
 */
async function armNominationTarget(
  db: Db,
  lineup: LineupRow,
  judgedTarget: number,
): Promise<void> {
  if (lineup.nominationTargetBelowSeenAt != null) return;
  const armed = await stampBelowSeen(
    db,
    lineup.id,
    judgedTarget,
    lineup.updatedAt,
  );
  if (!armed) await armIfBelowTarget(db, lineup.id, judgedTarget);
}

/**
 * Id-based arm write, pinned to the state that judged the lineup below target.
 *
 * - `below_seen_at IS NULL` keeps an earlier arm intact.
 * - `nomination_target_pct = judgedTarget` AND `disarmed_at IS NULL` (ROK-1710):
 *   a nomination that read the row before a target edit (or a revert) landed
 *   must not re-arm it afterwards. Without this, a lineup the edit left
 *   unarmed at/above its NEW target was armed by the stale stamp and advanced
 *   on the very next nomination.
 * - `updated_at = readUpdatedAt` (ROK-1710 Codex round 5), when the write
 *   comes from an evaluation's snapshot: an edit sequence that ends on the
 *   judged pct (75 -> 50 -> 75) restores pct and both stamps, but every
 *   target edit bumps `updated_at`, so the stale arm matches no row.
 *   Nominating and unnominating never bump `updated_at`, so a live arm is not
 *   refused by its own path; an unrelated bump in the read-to-write window is
 *   re-judged on live data by `armNominationTarget`'s fallback. Compared at
 *   ms precision: the JS Date
 *   read back is ms, while `defaultNow()` stores microseconds. Omitted for the
 *   create and edit paths, which read the row fresh under the edit's lock.
 */
export function belowSeenStampCondition(
  lineupId: number,
  judgedTarget: number,
  readUpdatedAt?: Date,
) {
  const t = schema.communityLineups;
  return and(
    eq(t.id, lineupId),
    isNull(t.nominationTargetBelowSeenAt),
    eq(t.nominationTargetPct, judgedTarget),
    isNull(t.nominationTargetDisarmedAt),
    readUpdatedAt === undefined
      ? undefined
      : sql`date_trunc('milliseconds', ${t.updatedAt}) = ${readUpdatedAt.toISOString()}::timestamp`,
  );
}

async function stampBelowSeen(
  db: DbOrTx,
  lineupId: number,
  judgedTarget: number,
  readUpdatedAt?: Date,
): Promise<boolean> {
  const written = await db
    .update(schema.communityLineups)
    .set({ nominationTargetBelowSeenAt: new Date() })
    .where(belowSeenStampCondition(lineupId, judgedTarget, readUpdatedAt))
    .returning({ id: schema.communityLineups.id });
  return written.length > 0;
}

/**
 * Arm the rising edge only when the lineup is currently BELOW `target`.
 * Shared by creation and by an explicit target edit (ROK-1710): a lineup at
 * or above the target is a standing condition and must stay unarmed.
 */
async function armIfBelowTarget(
  db: DbOrTx,
  lineupId: number,
  target: number,
): Promise<void> {
  const rows = await db
    .select({ id: schema.communityLineupEntries.id })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  // Read the cap fresh from the id: at creation the row passed in is the
  // PRE-carry-over one, whose `nominationCapPeak` is still null.
  const cap = await loadEffectiveNominationCapById(db, lineupId);
  if (nominationTargetPercent(rows.length, cap) < target) {
    await stampBelowSeen(db, lineupId, target);
  }
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
  // `carryOverFromLastDecided` has already pinned the cap peak — that, not
  // this, is the ratchet point, or a deadline-only lineup (target null,
  // early-returned above) would never pin at all.
  await armIfBelowTarget(db, lineup.id, target);
}

/** 409 text for a target edit made while an early advance counts down. */
export const PENDING_ADVANCE_EDIT_MESSAGE =
  'An early advance is already counting down — wait for it or advance manually';

/**
 * True when an edit to `nextPct` changes nothing: same target AND the lineup
 * is not disarmed. Re-sending the current value on a disarmed lineup is the
 * operator re-arming on purpose, so it is NOT a no-op (ROK-1710).
 */
export function isNominationTargetEditNoop(
  lineup: Pick<LineupRow, 'nominationTargetPct' | 'nominationTargetDisarmedAt'>,
  nextPct: number | null,
): boolean {
  return (
    nextPct === (lineup.nominationTargetPct ?? null) &&
    lineup.nominationTargetDisarmedAt == null
  );
}

/**
 * Apply an explicit target edit (ROK-1710 re-arm rule).
 *
 * One UPDATE writes the new pct and clears BOTH stamps — the sticky disarm and
 * the rising-edge arm — then the create-time arm check runs against the new
 * target. Consequences: a lineup below the new target arms and opens voting on
 * the next crossing; one already at/above it stays unarmed (standing
 * condition, no instant advance); null turns the target off cleanly. The
 * ROK-1253 revert pause (`auto_advance_paused_at`) is untouched, so a
 * just-reverted lineup still cannot auto-advance while it lasts. The caller
 * owns the `building`-only status gate and runs this inside the transaction
 * that holds the lineup row lock (`authorizeAndPersistMetadata`).
 *
 * A target edit is refused while an early advance is pending
 * (`pending_advance_at` set, ROK-1710 Codex round 3): the countdown was judged
 * under the current target, so it runs out or the operator advances by hand.
 * The caller checks that on the locked row; the UPDATE repeats it in its
 * WHERE, and a write that matches no row fails the whole edit with a 409.
 */
export async function applyNominationTargetEdit(
  db: DbOrTx,
  lineup: LineupRow,
  nextPct: number | null,
): Promise<void> {
  if (isNominationTargetEditNoop(lineup, nextPct)) return;
  const t = schema.communityLineups;
  const written = await db
    .update(t)
    .set({
      nominationTargetPct: nextPct,
      nominationTargetDisarmedAt: null,
      nominationTargetBelowSeenAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(t.id, lineup.id), isNull(t.pendingAdvanceAt)))
    .returning({ id: t.id });
  if (written.length === 0) {
    throw new ConflictException(PENDING_ADVANCE_EDIT_MESSAGE);
  }
  if (nextPct !== null) await armIfBelowTarget(db, lineup.id, nextPct);
}
