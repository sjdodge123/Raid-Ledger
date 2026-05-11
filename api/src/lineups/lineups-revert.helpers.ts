/**
 * Backward-transition side effects (ROK-1253).
 *
 * When the operator reverts a lineup (voting → building, decided → voting,
 * archived → decided) we:
 *
 *  1. Cancel any pending grace-advance BullMQ job (idempotent).
 *  2. Append a `lineup_auto_advance_paused` activity entry so operators can
 *     see the pause in the timeline.
 *
 * The pause stamp itself is written by `buildAdvanceStateUpdate` inside the
 * same atomic UPDATE that flips status (see `applyStatusUpdate`).
 */
import type { ActivityLogService } from '../activity-log/activity-log.service';
import { VALID_REVERSIONS } from './lineups-query.helpers';
import type { LineupStatus } from '../drizzle/schema';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { logAutoAdvancePaused } from './lineups-activity.helpers';

interface RevertDeps {
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
  await logAutoAdvancePaused(
    deps.activityLog,
    lineupId,
    actorId,
    fromStatus,
    toStatus,
  );
}
