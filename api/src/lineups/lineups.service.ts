import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  BandwagonJoinResponseDto,
  CommonGroundQueryDto,
  CommonGroundResponseDto,
  CreateLineupDto,
  GroupedMatchesResponseDto,
  LineupBannerResponseDto,
  LineupDetailResponseDto,
  NominateGameDto,
  UpdateLineupMetadataDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { guardTiebreakerOnTransition } from './tiebreaker/tiebreaker-detect.helpers';
import { LineupNotificationService } from './lineup-notification.service';
import {
  findActiveLineup,
  findLineupById,
  findBuildingLineup,
  findNominatedGameIds,
  countDistinctNominators,
  validateDecidedGame,
} from './lineups-query.helpers';
import {
  insertLineup,
  applyStatusUpdate,
  runMatchingAlgorithm,
  validateTransition,
} from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { buildCommonGroundResponse } from './common-ground-query.helpers';
import { findBannerLineup, buildBannerData } from './lineups-banner.helpers';
import {
  findEntry,
  validateRemoval,
  deleteEntry,
} from './lineups-removal.helpers';
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
import { logTransition, logNomination } from './lineups-activity.helpers';
import { toggleVote as toggleVoteHelper } from './lineups-voting.helpers';
import { buildGroupedMatchesResponse } from './lineups-match-response.helpers';
import {
  executeBandwagonJoin,
  advanceMatch as advanceMatchHelper,
} from './lineups-bandwagon.helpers';
import { carryOverFromLastDecided } from './lineups-carryover.helpers';
import { authorizeAndPersistMetadata } from './lineups-metadata.helpers';
import {
  fireLineupCreated,
  fireNominationMilestone,
  fireVotingOpen,
  fireDecidedNotifications,
  fireNominationRemoved,
  fireSchedulingOpen,
} from './lineups-notify-hooks.helpers';

/** Caller identity for authorization checks. */
export interface CallerIdentity {
  id: number;
  role: string;
}

@Injectable()
export class LineupsService {
  private readonly logger = new Logger(LineupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly activityLog: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly phaseQueue: LineupPhaseQueueService,
    private readonly steamNudge: LineupSteamNudgeService,
    private readonly lineupNotifications: LineupNotificationService,
  ) {}

  /** Create a new lineup. Throws 409 if an active lineup already exists. */
  async create(
    dto: CreateLineupDto,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const overrides = hasDurationParams(dto) ? buildOverrides(dto) : null;
    const phaseDeadline = await computeInitialDeadline(dto, this.settings);

    const [row] = await insertLineup(
      this.db,
      dto,
      userId,
      phaseDeadline,
      overrides,
    );
    await this.activityLog.log('lineup', row.id, 'lineup_created', userId);
    void this.steamNudge.nudgeUnlinkedMembers(row.id);
    await carryOverFromLastDecided(this.db, row.id);

    const delayMs = phaseDeadline.getTime() - Date.now();
    await this.phaseQueue.scheduleTransition(row.id, 'voting', delayMs);

    fireLineupCreated(this.lineupNotifications, this.logger, {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
    });

    return buildDetailResponse(this.db, row.id);
  }

  /** Get the currently active lineup (building or voting). */
  async findActive(userId?: number): Promise<LineupDetailResponseDto> {
    const [row] = await findActiveLineup(this.db);
    if (!row) throw new NotFoundException('No active lineup');
    return buildDetailResponse(this.db, row.id, userId);
  }

  /** Get a lineup by ID with full detail. */
  async findById(
    id: number,
    userId?: number,
  ): Promise<LineupDetailResponseDto> {
    return buildDetailResponse(this.db, id, userId);
  }

  /** Toggle a vote for a game in a lineup (ROK-936). */
  async toggleVote(
    lineupId: number,
    gameId: number,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'voting') {
      throw new BadRequestException('Voting is only allowed in voting status');
    }
    const action = await toggleVoteHelper(
      this.db,
      lineupId,
      userId,
      gameId,
      lineup.maxVotesPerPlayer ?? 3,
    );
    await this.activityLog.log('lineup', lineupId, 'vote_cast', userId, {
      gameId,
      action,
    });
    return buildDetailResponse(this.db, lineupId, userId);
  }

  /** Transition a lineup to a new status. */
  async transitionStatus(
    id: number,
    dto: UpdateLineupStatusDto,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, id);
    if (!lineup) throw new NotFoundException('Lineup not found');

    validateTransition(lineup.status as LineupStatus, dto);
    if (dto.status === 'decided' && dto.decidedGameId) {
      await validateDecidedGame(this.db, id, dto.decidedGameId);
    }

    // Tiebreaker gate: block ties, override winner, or reset (ROK-938)
    await guardTiebreakerOnTransition(this.db, id, lineup.status, dto);

    await applyStatusUpdate(
      this.db,
      this.settings,
      this.phaseQueue,
      id,
      dto,
      lineup,
    );
    if (dto.status === 'decided') {
      await runMatchingAlgorithm(this.db, id, this.logger);
    }
    await logTransition(this.db, this.activityLog, id, dto);

    if (dto.status === 'voting') {
      fireVotingOpen(
        this.lineupNotifications,
        this.logger,
        this.db,
        id,
        lineup.phaseDeadline,
      );
    }
    if (dto.status === 'decided') {
      fireDecidedNotifications(
        this.lineupNotifications,
        this.logger,
        this.db,
        id,
      );
    }
    return buildDetailResponse(this.db, id);
  }

  /** Get Common Ground games — ownership overlap. */
  async getCommonGround(
    filters: CommonGroundQueryDto,
  ): Promise<CommonGroundResponseDto> {
    const [lineup] = await findBuildingLineup(this.db);
    if (!lineup)
      throw new NotFoundException('No active lineup in building status');
    const nominated = await findNominatedGameIds(this.db, lineup.id);
    const [nominators] = await countDistinctNominators(this.db, lineup.id);
    return buildCommonGroundResponse(
      this.db,
      lineup.id,
      nominated,
      nominators?.count ?? 0,
      filters,
    );
  }

  /** Nominate a game into a lineup. */
  async nominate(lineupId: number, dto: NominateGameDto, userId: number) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building')
      throw new BadRequestException('Lineup is not in building status');

    await validateNominationCap(this.db, lineupId);
    await validateGameExists(this.db, dto.gameId);
    await insertNomination(this.db, lineupId, dto, userId);
    await logNomination(this.db, this.activityLog, lineupId, dto, userId);

    fireNominationMilestone(
      this.lineupNotifications,
      this.logger,
      this.db,
      lineupId,
    );

    return buildDetailResponse(this.db, lineupId);
  }

  /** Remove a nomination. */
  async removeNomination(
    lineupId: number,
    gameId: number,
    caller: CallerIdentity,
  ) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building')
      throw new BadRequestException('Can only remove during building');

    const entry = await findEntry(this.db, lineupId, gameId);
    validateRemoval(entry, caller);
    await deleteEntry(this.db, lineupId, gameId);
    await this.activityLog.log(
      'lineup',
      lineupId,
      'nomination_removed',
      caller.id,
      { gameId },
    );

    fireNominationRemoved(
      this.lineupNotifications,
      this.logger,
      this.db,
      lineupId,
      gameId,
      entry,
      caller,
    );
  }

  /** Get banner data for the Games page. Returns null if no eligible lineup. */
  async findBanner(): Promise<LineupBannerResponseDto | null> {
    const [lineup] = await findBannerLineup(this.db);
    if (!lineup) return null;
    return buildBannerData(this.db, lineup);
  }

  /** Get grouped matches for decided view (ROK-937). */
  async getGroupedMatches(id: number): Promise<GroupedMatchesResponseDto> {
    return buildGroupedMatchesResponse(this.db, id);
  }

  /** Bandwagon join a match (ROK-937). */
  async bandwagonJoin(
    lineupId: number,
    matchId: number,
    userId: number,
  ): Promise<BandwagonJoinResponseDto> {
    const result = await executeBandwagonJoin(
      this.db,
      lineupId,
      matchId,
      userId,
    );
    this.firePromoted(result.promoted, matchId);
    return result;
  }

  /** Advance a suggested match to scheduling (ROK-937). */
  async advanceMatch(
    lineupId: number,
    matchId: number,
  ): Promise<{ promoted: boolean }> {
    const result = await advanceMatchHelper(this.db, lineupId, matchId);
    this.firePromoted(result.promoted, matchId);
    return result;
  }

  private firePromoted(promoted: boolean, matchId: number): void {
    if (!promoted) return;
    fireSchedulingOpen(this.lineupNotifications, this.logger, this.db, matchId);
  }

  /** Update a lineup's title and/or description (ROK-1063). */
  async updateMetadata(
    id: number,
    dto: UpdateLineupMetadataDto,
    caller: CallerIdentity,
  ): Promise<LineupDetailResponseDto> {
    await authorizeAndPersistMetadata(this.db, id, dto, caller);
    return buildDetailResponse(this.db, id, caller.id);
  }
}
