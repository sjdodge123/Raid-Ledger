/**
 * Action orchestration helpers extracted from LineupsService (ROK-1065).
 * Kept separate so lineups.service.ts stays under the 300-line ESLint ceiling.
 *
 * Each helper is a direct 1:1 extraction of a service method body — the
 * service remains the public entry point for tests/controllers.
 */
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateLineupDto,
  LineupDetailResponseDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import type { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import type { LineupNotificationService } from './lineup-notification.service';
import { findLineupById } from './lineups-query.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';
import { insertLineup } from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import {
  validateNominationCap,
  validateGameExists,
  insertNomination,
} from './lineups-nomination.helpers';
import {
  hasDurationParams,
  buildOverrides,
  computeInitialDeadline,
} from './lineups-phase.helpers';
import { logNomination } from './lineups-activity.helpers';
import { toggleVote as toggleVoteHelper } from './lineups-voting.helpers';
import { carryOverFromLastDecided } from './lineups-carryover.helpers';
import {
  fireLineupCreated,
  fireNominationMilestone,
  fireNominationRemoved,
} from './lineups-notify-hooks.helpers';
import {
  findEntry,
  validateRemoval,
  deleteEntry,
} from './lineups-removal.helpers';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;
type ResolveChannelName = (channelId: string) => string | null;

export interface CreateLineupDeps {
  db: Db;
  activityLog: ActivityLogService;
  settings: SettingsService;
  phaseQueue: LineupPhaseQueueService;
  steamNudge: LineupSteamNudgeService;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
  resolveChannelName: ResolveChannelName;
}

/**
 * Create a new lineup (ROK-1065).
 * Multiple lineups may be active simultaneously post-ROK-1065. Steam nudges
 * and carryover only fire for public lineups since private lineups have a
 * scoped participant roster.
 */
export async function runCreateLineup(
  deps: CreateLineupDeps,
  dto: CreateLineupDto,
  userId: number,
): Promise<LineupDetailResponseDto> {
  const overrides = hasDurationParams(dto) ? buildOverrides(dto) : null;
  const phaseDeadline = await computeInitialDeadline(dto, deps.settings);

  const [row] = await insertLineup(
    deps.db,
    dto,
    userId,
    phaseDeadline,
    overrides,
  );
  await deps.activityLog.log('lineup', row.id, 'lineup_created', userId);
  if (row.visibility === 'public') {
    void deps.steamNudge.nudgeUnlinkedMembers(row.id);
    await carryOverFromLastDecided(deps.db, row.id);
  }

  const delayMs = phaseDeadline.getTime() - Date.now();
  await deps.phaseQueue.scheduleTransition(row.id, 'voting', delayMs);

  fireLineupCreated(deps.lineupNotifications, deps.logger, {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
    channelOverrideId: row.channelOverrideId ?? null,
    visibility: row.visibility,
  });

  return buildDetailResponse(
    deps.db,
    row.id,
    undefined,
    deps.resolveChannelName,
  );
}

export interface VoteDeps {
  db: Db;
  activityLog: ActivityLogService;
  resolveChannelName: ResolveChannelName;
}

/** Toggle a vote for a game in a lineup (ROK-936). */
export async function runToggleVote(
  deps: VoteDeps,
  lineupId: number,
  gameId: number,
  userId: number,
  callerRole: string | undefined,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(deps.db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'voting') {
    throw new BadRequestException('Voting is only allowed in voting status');
  }
  await assertUserCanParticipate(deps.db, lineup, {
    id: userId,
    role: callerRole,
  });
  const action = await toggleVoteHelper(
    deps.db,
    lineupId,
    userId,
    gameId,
    lineup.maxVotesPerPlayer ?? 3,
  );
  await deps.activityLog.log('lineup', lineupId, 'vote_cast', userId, {
    gameId,
    action,
  });
  return buildDetailResponse(
    deps.db,
    lineupId,
    userId,
    deps.resolveChannelName,
  );
}

export interface NominateDeps {
  db: Db;
  activityLog: ActivityLogService;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
  resolveChannelName: ResolveChannelName;
}

export interface RemoveNominationDeps {
  db: Db;
  activityLog: ActivityLogService;
  lineupNotifications: LineupNotificationService;
  logger: Logger;
}

/** Remove a nomination during the building phase. */
export async function runRemoveNomination(
  deps: RemoveNominationDeps,
  lineupId: number,
  gameId: number,
  caller: CallerIdentity,
): Promise<void> {
  const [lineup] = await findLineupById(deps.db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'building') {
    throw new BadRequestException('Can only remove during building');
  }

  const entry = await findEntry(deps.db, lineupId, gameId);
  validateRemoval(entry, caller);
  await deleteEntry(deps.db, lineupId, gameId);
  await deps.activityLog.log(
    'lineup',
    lineupId,
    'nomination_removed',
    caller.id,
    { gameId },
  );

  fireNominationRemoved(
    deps.lineupNotifications,
    deps.logger,
    deps.db,
    lineupId,
    gameId,
    entry,
    caller,
  );
}

/** Nominate a game into a lineup. */
export async function runNominate(
  deps: NominateDeps,
  lineupId: number,
  dto: NominateGameDto,
  userId: number,
  callerRole: string | undefined,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(deps.db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');
  if (lineup.status !== 'building')
    throw new BadRequestException('Lineup is not in building status');
  await assertUserCanParticipate(deps.db, lineup, {
    id: userId,
    role: callerRole,
  });

  await validateNominationCap(deps.db, lineupId);
  await validateGameExists(deps.db, dto.gameId);
  await insertNomination(deps.db, lineupId, dto, userId);
  await logNomination(deps.db, deps.activityLog, lineupId, dto, userId);

  fireNominationMilestone(
    deps.lineupNotifications,
    deps.logger,
    deps.db,
    lineupId,
  );

  return buildDetailResponse(
    deps.db,
    lineupId,
    undefined,
    deps.resolveChannelName,
  );
}
