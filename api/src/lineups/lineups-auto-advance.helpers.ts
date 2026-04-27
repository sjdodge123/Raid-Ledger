/**
 * Auto-advance orchestration for lineup status (ROK-1118).
 *
 * Called fire-and-forget after every nominate / vote / unnominate. Loads
 * the lineup, routes to the building or voting quorum check, and (when
 * ready) calls `runStatusTransition` to flip the status. Errors are
 * caught and logged — the caller's mutation must never fail because the
 * advance attempt failed.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import type { LineupNotificationService } from './lineup-notification.service';
import { findLineupById } from './lineups-query.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from './quorum/quorum-check.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface AutoAdvanceDeps {
  db: Db;
  activityLog: ActivityLogService;
  settings: SettingsService;
  phaseQueue: LineupPhaseQueueService;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
}

const NEXT_STATUS: Partial<Record<LineupStatus, LineupStatus>> = {
  building: 'voting',
  voting: 'decided',
};

/** Try to auto-advance a lineup to its next phase if quorum is met. */
export async function maybeAutoAdvance(
  deps: AutoAdvanceDeps,
  lineupId: number,
): Promise<void> {
  try {
    const [lineup] = await findLineupById(deps.db, lineupId);
    if (!lineup) return;
    const nextStatus = NEXT_STATUS[lineup.status as LineupStatus];
    if (!nextStatus) return;

    const result =
      lineup.status === 'building'
        ? await checkBuildingQuorum(deps.db, deps.settings, lineup)
        : await checkVotingQuorum(deps.db, lineup);
    if (!result.ready) return;

    await runStatusTransition(deps, lineupId, { status: nextStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`maybeAutoAdvance(${lineupId}) skipped: ${msg}`);
  }
}
