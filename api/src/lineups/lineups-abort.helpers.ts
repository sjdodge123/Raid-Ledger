/**
 * Admin abort orchestrator for community lineups (ROK-1062).
 *
 * Force-archives a lineup from any non-archived status, resetting any
 * active tiebreaker, cancelling phase queue jobs, emitting the websocket
 * status change, writing the activity log row, and posting the abort
 * channel embed (best-effort — embed failure does NOT roll back the DB
 * write).
 *
 * Mirrors `lineups-transition.helpers.ts` so the lineups service stays a
 * thin wrapper over this orchestrator.
 */
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import type { LineupNotificationService } from './lineup-notification.service';
import type { LineupsGateway } from './lineups.gateway';
import type { TiebreakerService } from './tiebreaker/tiebreaker.service';
import { findLineupById, findUserDisplayName } from './lineups-query.helpers';
import { applyStatusUpdate } from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { logAborted } from './lineups-activity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface AbortDeps {
  db: Db;
  activityLog: ActivityLogService;
  phaseQueue: LineupPhaseQueueService;
  lineupNotifications: LineupNotificationService;
  lineupsGateway: LineupsGateway;
  tiebreaker: TiebreakerService;
  logger: Logger;
}

/**
 * Load the lineup and reject already-archived rows with a 409. Returns the
 * full row so the caller can pass it to `applyStatusUpdate` (the CAS clause
 * keys off `lineup.status` for concurrent-write detection).
 */
async function loadAndValidateLineup(db: Db, id: number) {
  const [lineup] = await findLineupById(db, id);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status === 'archived') {
    throw new ConflictException(`Lineup ${id} is already archived`);
  }
  return lineup;
}

/**
 * Fire-and-await the abort embed but swallow rejection. Embed dispatch can
 * fail for benign reasons (no bound channel, Discord rate limit, bot offline)
 * and the spec mandates the DB write succeed regardless.
 */
async function notifyAbortSafe(
  notifications: LineupNotificationService,
  lineup: { id: number; channelOverrideId: string | null },
  preAbortStatus: 'building' | 'voting' | 'decided' | 'archived',
  reason: string | null,
  actorDisplayName: string,
  logger: Logger,
): Promise<void> {
  try {
    await notifications.notifyLineupAborted(
      {
        id: lineup.id,
        channelOverrideId: lineup.channelOverrideId,
        preAbortStatus,
      },
      reason,
      actorDisplayName,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Lineup abort embed failed for ${lineup.id}: ${msg}`);
  }
}

/**
 * Apply the archival side-effects after the CAS UPDATE has succeeded:
 * cancel queue jobs, emit websocket, log activity, post embed best-effort.
 */
async function finalizeAbort(
  deps: AbortDeps,
  lineup: typeof schema.communityLineups.$inferSelect,
  reason: string | null,
  actorId: number,
): Promise<void> {
  await deps.phaseQueue.cancelAllForLineup(lineup.id);
  deps.lineupsGateway.emitStatusChange(lineup.id, 'archived', new Date());
  const actorDisplayName = await findUserDisplayName(deps.db, actorId);
  await logAborted(deps.activityLog, lineup.id, actorId, reason);
  await notifyAbortSafe(
    deps.lineupNotifications,
    lineup,
    lineup.status,
    reason,
    actorDisplayName,
    deps.logger,
  );
}

/** Orchestrate an admin force-archive of a community lineup (ROK-1062). */
export async function runLineupAbort(
  deps: AbortDeps,
  id: number,
  reason: string | null | undefined,
  actorId: number,
): Promise<LineupDetailResponseDto> {
  const lineup = await loadAndValidateLineup(deps.db, id);
  await deps.tiebreaker.reset(id);
  await applyStatusUpdate(
    deps.db,
    deps.phaseQueue,
    id,
    { status: 'archived' },
    lineup,
  );
  const trimmedReason = reason?.trim() || null;
  await finalizeAbort(deps, lineup, trimmedReason, actorId);
  return buildDetailResponse(deps.db, id);
}
