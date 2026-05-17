/**
 * Backward-transition side effects (ROK-1253, ROK-1296).
 *
 * When the operator reverts a lineup (voting → building, decided → voting,
 * archived → decided) we:
 *
 *  1. Cancel any pending grace-advance BullMQ job (idempotent).
 *  2. Append a `lineup_auto_advance_paused` activity entry so operators can
 *     see the pause in the timeline.
 *  3. ROK-1296 (Codex P2): clear the `*_submitted_at` column relevant to
 *     the destination phase so the next quorum check doesn't auto-advance
 *     again on yesterday's submissions. The pause TTL only buys time —
 *     after it expires, stale stamps would satisfy quorum on the very next
 *     nominate/vote.
 *
 * The pause stamp itself is written by `buildAdvanceStateUpdate` inside the
 * same atomic UPDATE that flips status (see `applyStatusUpdate`).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import { VALID_REVERSIONS } from './lineups-query.helpers';
import type { LineupStatus } from '../drizzle/schema';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { logAutoAdvancePaused } from './lineups-activity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

interface RevertDeps {
  db: Db;
  activityLog: ActivityLogService;
  phaseQueue: LineupPhaseQueueService;
}

/** True if `to` is the registered reversion target for `from`. */
function isReversion(from: LineupStatus, to: string): boolean {
  return VALID_REVERSIONS[from] === to;
}

/** Apply the side-effects associated with a backwards transition. */
export async function applyRevertSideEffects(
  deps: RevertDeps,
  lineupId: number,
  fromStatus: LineupStatus,
  toStatus: string,
  actorId: number,
): Promise<void> {
  if (!isReversion(fromStatus, toStatus)) return;
  await deps.phaseQueue.cancelGraceAdvance(lineupId);
  await clearStaleSubmissionStamps(deps.db, lineupId, toStatus as LineupStatus);
  await logAutoAdvancePaused(
    deps.activityLog,
    lineupId,
    actorId,
    fromStatus,
    toStatus,
  );
}

/**
 * Clear the submission timestamp(s) that gate the destination phase's
 * quorum check. Stale stamps from a prior pass through this phase would
 * otherwise auto-advance the lineup once the pause TTL expires.
 *
 * Mapping (per `quorum-check.helpers.ts`):
 *   - building → checkBuildingQuorum reads `nominations_submitted_at`
 *   - voting   → checkVotingQuorum reads `votes_submitted_at`
 *   - decided  → no quorum check (no reversion target writes here today)
 */
async function clearStaleSubmissionStamps(
  db: Db,
  lineupId: number,
  toStatus: LineupStatus,
): Promise<void> {
  if (toStatus === 'building') {
    await db
      .update(schema.communityLineupUserSubmissions)
      .set({ nominationsSubmittedAt: null, updatedAt: new Date() })
      .where(eq(schema.communityLineupUserSubmissions.lineupId, lineupId));
    return;
  }
  if (toStatus === 'voting') {
    await db
      .update(schema.communityLineupUserSubmissions)
      .set({ votesSubmittedAt: null, updatedAt: new Date() })
      .where(eq(schema.communityLineupUserSubmissions.lineupId, lineupId));
  }
}
