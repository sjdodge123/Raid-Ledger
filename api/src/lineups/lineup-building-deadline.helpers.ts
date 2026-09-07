/**
 * Building-deadline nomination floor (ROK-1443).
 *
 * Bug: the deadline job advanced `building → voting` on status adjacency
 * alone, so a lineup nobody nominated on opened a vote with nothing to vote
 * on. Operator ruling 2026-09-06: fewer than two nominations at the building
 * deadline → extend the window ONCE, then abort. The extension memory is the
 * activity log (`lineup_deadline_extended` rows survive a `voting → building`
 * revert), so no schema change.
 *
 * Scope: ONLY the deadline job (`LineupPhaseProcessor.executeTransition`)
 * calls this. The manual operator Advance (`LineupsService.transitionStatus`
 * → `runStatusTransition`) never enters the processor and stays a deliberate
 * override; the grace/quorum path keeps its own `checkBuildingQuorum` floor.
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { notifyDeadlineExtended } from './lineup-notification-deadline-extended.helpers';
import { runLineupAbort, type AbortDeps } from './lineups-abort.helpers';
import {
  countDeadlineExtensions,
  logDeadlineExtended,
} from './lineups-activity.helpers';
import { computeTransitionDeadline } from './lineups-phase.helpers';
import { countLineupEntries } from './lineups-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Lineup = typeof schema.communityLineups.$inferSelect;

/**
 * A literal, NOT `LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS` (default 4): that
 * setting gates quorum ("enough on the board to advance early"); this floor
 * answers "is there anything to vote on at all".
 */
export const BUILDING_DEADLINE_MIN_NOMINATIONS = 2;

/** Abort reason written to the activity row and the channel embed. */
export const NOBODY_NOMINATED_REASON =
  'Nobody nominated a game before the deadline.';

export type BuildingDeadlineOutcome = 'advance' | 'extend' | 'abort';

/** Everything the abort path needs is everything this path needs. */
export type BuildingDeadlineDeps = AbortDeps;

/** Pure decision — no I/O, no clock. */
export function decideBuildingDeadline(
  nominationCount: number,
  alreadyExtended: boolean,
): BuildingDeadlineOutcome {
  if (nominationCount >= BUILDING_DEADLINE_MIN_NOMINATIONS) return 'advance';
  return alreadyExtended ? 'abort' : 'extend';
}

/** Nominations currently on the board (`community_lineup_entries`). */
export async function countLineupNominations(
  db: Db,
  lineupId: number,
): Promise<number> {
  const [row] = await countLineupEntries(db, lineupId);
  return row?.count ?? 0;
}

/**
 * Deadline-job guard for `building → voting`. Returns `true` when the expiry
 * was handled here (extended or aborted) and the caller must NOT transition;
 * `false` means the floor is met and the normal transition proceeds.
 */
export async function runBuildingDeadlineGuard(
  deps: BuildingDeadlineDeps,
  lineup: Lineup,
): Promise<boolean> {
  const [nominationCount, extensions] = await Promise.all([
    countLineupNominations(deps.db, lineup.id),
    countDeadlineExtensions(deps.db, lineup.id),
  ]);
  const outcome = decideBuildingDeadline(nominationCount, extensions >= 1);
  if (outcome === 'advance') return false;
  deps.logger.log(
    `Lineup ${lineup.id} hit its building deadline with ${nominationCount} nomination(s) — ${outcome}`,
  );
  if (outcome === 'extend') {
    await extendBuildingDeadline(deps, lineup, nominationCount);
  } else {
    await abortForNoNominations(deps, lineup.id);
  }
  return true;
}

/**
 * Compare-and-set the deadline forward by one building duration. The
 * `phase_deadline <= now` clause is the idempotency key: a BullMQ retry after
 * a partial failure re-runs this, matches zero rows (the deadline is already
 * in the future), and only completes the bookkeeping below.
 */
async function casExtendDeadline(
  db: Db,
  lineup: Lineup,
  newDeadline: Date,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(schema.communityLineups)
    .set({ phaseDeadline: newDeadline, updatedAt: now })
    .where(
      and(
        eq(schema.communityLineups.id, lineup.id),
        eq(schema.communityLineups.status, 'building'),
        or(
          isNull(schema.communityLineups.phaseDeadline),
          lte(schema.communityLineups.phaseDeadline, now),
        ),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return updated.length > 0;
}

/** The row's live deadline, only while it is still building and in the future. */
async function liveFutureDeadline(
  db: Db,
  lineupId: number,
  now: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ phaseDeadline: schema.communityLineups.phaseDeadline })
    .from(schema.communityLineups)
    .where(
      and(
        eq(schema.communityLineups.id, lineupId),
        eq(schema.communityLineups.status, 'building'),
        gt(schema.communityLineups.phaseDeadline, now),
      ),
    )
    .limit(1);
  return row?.phaseDeadline ?? null;
}

/**
 * Extend once, in D6 order: CAS the deadline, write the activity row, then
 * re-enqueue the `voting` job for the new deadline (the normal scheduler lives
 * in `applyStatusUpdate`, which this path never calls), then the channel
 * notice.
 *
 * This runs INSIDE the `voting` job it re-schedules, so the base jobId is
 * still active; `scheduleTransition` parks the replacement under its `-r`
 * twin (`LineupPhaseQueueService.freeTransitionJobId`).
 */
async function extendBuildingDeadline(
  deps: BuildingDeadlineDeps,
  lineup: Lineup,
  nominationCount: number,
): Promise<void> {
  const now = new Date();
  const computed = computeTransitionDeadline('building', lineup);
  if (!computed) {
    throw new Error(`No building duration resolved for lineup ${lineup.id}`);
  }
  const extended = await casExtendDeadline(deps.db, lineup, computed, now);
  const newDeadline = extended
    ? computed
    : await liveFutureDeadline(deps.db, lineup.id, now);
  if (!newDeadline) {
    deps.logger.debug(`Lineup ${lineup.id} moved on mid-extend — no-op`);
    return;
  }
  // D6 order: UPDATE first, activity row SECOND, re-enqueue third, embed last.
  // The row is the extension's memory (`countDeadlineExtensions`), so it must
  // exist before anything else can observe the extended window — including the
  // re-enqueued job itself, which fires on that new deadline (review L1).
  await logDeadlineExtended(deps.activityLog, lineup.id, {
    previousDeadline: lineup.phaseDeadline?.toISOString() ?? null,
    newDeadline: newDeadline.toISOString(),
    nominationCount,
  });
  await deps.phaseQueue.scheduleTransition(
    lineup.id,
    'voting',
    Math.max(0, newDeadline.getTime() - Date.now()),
  );
  await notifyExtendedSafe(deps, lineup, newDeadline, nominationCount);
}

/** Best-effort embed — a Discord failure must not roll back the extension. */
async function notifyExtendedSafe(
  deps: BuildingDeadlineDeps,
  lineup: Lineup,
  newDeadline: Date,
  nominationCount: number,
): Promise<void> {
  try {
    await notifyDeadlineExtended(
      deps.lineupNotifications.tieDeps,
      lineup,
      newDeadline,
      nominationCount,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`Deadline-extended embed failed for ${lineup.id}: ${msg}`);
  }
}

/**
 * Second sub-floor expiry: archive through the shared abort orchestrator
 * (tiebreaker reset, cancel queue jobs, gateway emit, activity row, embed).
 * A `ConflictException` means another path won the race — expected no-op.
 */
async function abortForNoNominations(
  deps: BuildingDeadlineDeps,
  lineupId: number,
): Promise<void> {
  try {
    await runLineupAbort(deps, lineupId, NOBODY_NOMINATED_REASON, null);
  } catch (err) {
    if (!(err instanceof ConflictException)) throw err;
    deps.logger.debug(`Lineup ${lineupId} abort lost a CAS race — no-op`);
  }
}
