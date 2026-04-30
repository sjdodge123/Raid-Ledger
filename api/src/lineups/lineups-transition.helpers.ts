/**
 * Status transition helpers extracted from lineups.service.ts (ROK-1063).
 * Keeps the service under the 300-line ESLint limit.
 */
import { Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LineupDetailResponseDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { guardTiebreakerOnTransition } from './tiebreaker/tiebreaker-detect.helpers';
import type { LineupNotificationService } from './lineup-notification.service';
import { findLineupById, validateDecidedGame } from './lineups-query.helpers';
import {
  applyStatusUpdate,
  runMatchingAlgorithm,
  validateTransition,
} from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { logTransition } from './lineups-activity.helpers';
import {
  fireVotingOpen,
  fireDecidedNotifications,
} from './lineups-notify-hooks.helpers';
import type { LineupsGateway } from './lineups.gateway';

type Db = PostgresJsDatabase<typeof schema>;

export interface TransitionDeps {
  db: Db;
  activityLog: ActivityLogService;
  settings: SettingsService;
  phaseQueue: LineupPhaseQueueService;
  lineupNotifications: LineupNotificationService;
  lineupsGateway: LineupsGateway;
  logger: Logger;
}

/** Orchestrate a lineup status transition with validation, update, and hooks. */
export async function runStatusTransition(
  deps: TransitionDeps,
  id: number,
  dto: UpdateLineupStatusDto,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(deps.db, id);
  if (!lineup) throw new NotFoundException('Lineup not found');

  validateTransition(lineup.status, dto);
  if (dto.status === 'decided' && dto.decidedGameId) {
    await validateDecidedGame(deps.db, id, dto.decidedGameId);
  }

  await guardTiebreakerOnTransition(deps.db, id, lineup.status, dto);
  await applyStatusUpdate(
    deps.db,
    deps.settings,
    deps.phaseQueue,
    id,
    dto,
    lineup,
  );
  // ROK-1118: emit immediately after the conditional UPDATE succeeds so
  // subscribed clients see the phase flip without polling. The timestamp
  // matches the row's `updatedAt` we just wrote (within milliseconds).
  deps.lineupsGateway.emitStatusChange(id, dto.status, new Date());
  if (dto.status === 'decided') {
    await runMatchingAlgorithm(deps.db, id, deps.logger);
  }
  await logTransition(deps.db, deps.activityLog, id, dto);

  if (dto.status === 'voting') {
    fireVotingOpen(
      deps.lineupNotifications,
      deps.logger,
      deps.db,
      id,
      lineup.phaseDeadline,
    );
  }
  if (dto.status === 'decided') {
    fireDecidedNotifications(
      deps.lineupNotifications,
      deps.logger,
      deps.db,
      id,
    );
  }
  return buildDetailResponse(deps.db, id);
}
