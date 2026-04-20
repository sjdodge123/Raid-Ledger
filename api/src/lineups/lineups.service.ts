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
  LineupSummaryResponseDto,
  NominateGameDto,
  UpdateLineupMetadataDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';
import { LineupNotificationService } from './lineup-notification.service';
import { findActiveLineups, findLineupById } from './lineups-query.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';
import {
  runAddInvitees,
  runRemoveInvitee,
} from './lineups-invitees-actions.helpers';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { runCommonGroundForBuildingLineup } from './common-ground-context.helpers';
import { insertLineup } from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
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
import { logNomination } from './lineups-activity.helpers';
import { toggleVote as toggleVoteHelper } from './lineups-voting.helpers';
import { buildGroupedMatchesResponse } from './lineups-match-response.helpers';
import { carryOverFromLastDecided } from './lineups-carryover.helpers';
import { runMetadataUpdate } from './lineups-metadata.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  runBandwagonJoin,
  runAdvanceMatch,
} from './lineups-match-actions.helpers';
import {
  fireLineupCreated,
  fireNominationMilestone,
  fireNominationRemoved,
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
    private readonly botClient: DiscordBotClientService,
    private readonly tasteProfile: TasteProfileService,
  ) {}

  /** Resolve a Discord channel name from its ID via bot cache (ROK-1064). */
  private resolveChannelName = (channelId: string): string | null => {
    const guild = this.botClient.getGuild();
    const channel = guild?.channels?.cache?.get(channelId);
    return channel?.name ?? null;
  };

  /**
   * Create a new lineup (ROK-1065).
   * Multiple lineups may be active simultaneously post-ROK-1065. Steam
   * nudges and carryover only fire for public lineups since private lineups
   * have a scoped participant roster.
   */
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
    const isPublic = row.visibility === 'public';
    if (isPublic) {
      void this.steamNudge.nudgeUnlinkedMembers(row.id);
      await carryOverFromLastDecided(this.db, row.id);
    }

    const delayMs = phaseDeadline.getTime() - Date.now();
    await this.phaseQueue.scheduleTransition(row.id, 'voting', delayMs);

    fireLineupCreated(this.lineupNotifications, this.logger, {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      // ROK-1064: per-lineup Discord channel override.
      channelOverrideId: row.channelOverrideId ?? null,
      // ROK-1065: visibility drives DM vs. channel dispatch.
      visibility: row.visibility,
    });

    return buildDetailResponse(
      this.db,
      row.id,
      undefined,
      this.resolveChannelName,
    );
  }

  /**
   * Get every active lineup (ROK-1065).
   *
   * Returns `LineupSummaryResponseDto[]`. ROK-1065 changed this from a
   * singular detail object to an array — private lineups coexist with
   * public ones, so the client receives all in-flight lineups. Never
   * filtered by viewer; private participation is gated at mutation time.
   */
  async findActive(): Promise<
    import('@raid-ledger/contract').LineupSummaryResponseDto[]
  > {
    const rows = await findActiveLineups(this.db);
    const ids = rows.map((r) => r.id);
    const counts = await this.loadSummaryCounts(ids);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      targetDate: r.targetDate ? r.targetDate.toISOString() : null,
      entryCount: counts.entries.get(r.id) ?? 0,
      totalVoters: counts.voters.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      visibility: r.visibility,
    }));
  }

  /** Load entry and voter counts for multiple lineups in two queries. */
  private async loadSummaryCounts(lineupIds: number[]): Promise<{
    entries: Map<number, number>;
    voters: Map<number, number>;
  }> {
    if (lineupIds.length === 0) {
      return { entries: new Map(), voters: new Map() };
    }
    const entryRows = await this.db
      .select({
        lineupId: schema.communityLineupEntries.lineupId,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(schema.communityLineupEntries)
      .where(inArray(schema.communityLineupEntries.lineupId, lineupIds))
      .groupBy(schema.communityLineupEntries.lineupId);
    const voterRows = await this.db
      .select({
        lineupId: schema.communityLineupVotes.lineupId,
        count:
          sql<number>`count(distinct ${schema.communityLineupVotes.userId})::int`.as(
            'count',
          ),
      })
      .from(schema.communityLineupVotes)
      .where(inArray(schema.communityLineupVotes.lineupId, lineupIds))
      .groupBy(schema.communityLineupVotes.lineupId);
    return {
      entries: new Map(entryRows.map((r) => [r.lineupId, r.count])),
      voters: new Map(voterRows.map((r) => [r.lineupId, r.count])),
    };
  }

  /** Get a lineup by ID with full detail. */
  async findById(
    id: number,
    userId?: number,
  ): Promise<LineupDetailResponseDto> {
    return buildDetailResponse(this.db, id, userId, this.resolveChannelName);
  }

  /** Toggle a vote for a game in a lineup (ROK-936). */
  async toggleVote(
    lineupId: number,
    gameId: number,
    userId: number,
    callerRole?: string,
  ): Promise<LineupDetailResponseDto> {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'voting') {
      throw new BadRequestException('Voting is only allowed in voting status');
    }
    await assertUserCanParticipate(this.db, lineup, {
      id: userId,
      role: callerRole,
    });
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
    return buildDetailResponse(
      this.db,
      lineupId,
      userId,
      this.resolveChannelName,
    );
  }

  /** Transition a lineup to a new status. */
  transitionStatus(
    id: number,
    dto: UpdateLineupStatusDto,
  ): Promise<LineupDetailResponseDto> {
    return runStatusTransition(
      {
        db: this.db,
        activityLog: this.activityLog,
        settings: this.settings,
        phaseQueue: this.phaseQueue,
        lineupNotifications: this.lineupNotifications,
        logger: this.logger,
      },
      id,
      dto,
    );
  }

  /** Get Common Ground games — ownership overlap + taste scoring (ROK-950). */
  getCommonGround(
    filters: CommonGroundQueryDto,
  ): Promise<CommonGroundResponseDto> {
    return runCommonGroundForBuildingLineup(
      this.db,
      filters,
      this.tasteProfile,
      this.settings,
    );
  }

  /** Nominate a game into a lineup. */
  async nominate(
    lineupId: number,
    dto: NominateGameDto,
    userId: number,
    callerRole?: string,
  ) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'building')
      throw new BadRequestException('Lineup is not in building status');
    await assertUserCanParticipate(this.db, lineup, {
      id: userId,
      role: callerRole,
    });

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

    return buildDetailResponse(
      this.db,
      lineupId,
      undefined,
      this.resolveChannelName,
    );
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
  bandwagonJoin(
    lineupId: number,
    matchId: number,
    userId: number,
  ): Promise<BandwagonJoinResponseDto> {
    return runBandwagonJoin(
      this.db,
      this.lineupNotifications,
      this.logger,
      lineupId,
      matchId,
      userId,
    );
  }

  /** Advance a suggested match to scheduling (ROK-937). */
  advanceMatch(
    lineupId: number,
    matchId: number,
  ): Promise<{ promoted: boolean }> {
    return runAdvanceMatch(
      this.db,
      this.lineupNotifications,
      this.logger,
      lineupId,
      matchId,
    );
  }

  /** Update a lineup's title and/or description (ROK-1063). */
  async updateMetadata(
    id: number,
    dto: UpdateLineupMetadataDto,
    caller: CallerIdentity,
  ): Promise<LineupDetailResponseDto> {
    return runMetadataUpdate(
      this.db,
      this.lineupNotifications,
      this.logger,
      id,
      dto,
      caller,
    );
  }

  /**
   * Add one or more invitees to a lineup (ROK-1065).
   * 404s if any userId is unknown (the helper probes users first). Idempotent
   * for already-invited users via ON CONFLICT DO NOTHING.
   */
  addInvitees(
    lineupId: number,
    userIds: number[],
    callerId: number,
  ): Promise<LineupDetailResponseDto> {
    return runAddInvitees(
      this.db,
      this.resolveChannelName,
      lineupId,
      userIds,
      callerId,
    );
  }

  /** Remove a single invitee (ROK-1065). */
  removeInvitee(
    lineupId: number,
    userId: number,
    callerId: number,
  ): Promise<LineupDetailResponseDto> {
    return runRemoveInvitee(
      this.db,
      this.resolveChannelName,
      lineupId,
      userId,
      callerId,
    );
  }
}
