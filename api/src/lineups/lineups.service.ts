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
import { findLineupById } from './lineups-query.helpers';
import {
  runAddInvitees,
  runRemoveInvitee,
} from './lineups-invitees-actions.helpers';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { AiSuggestionsCacheInvalidator } from './ai-suggestions/cache.helpers';
import { runCommonGroundForBuildingLineup } from './common-ground-context.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { findBannerLineup, buildBannerData } from './lineups-banner.helpers';
import { buildActiveLineupSummaries } from './lineups-summary.helpers';
import {
  findEntry,
  validateRemoval,
  deleteEntry,
} from './lineups-removal.helpers';
import { buildGroupedMatchesResponse } from './lineups-match-response.helpers';
import { runMetadataUpdate } from './lineups-metadata.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  runBandwagonJoin,
  runAdvanceMatch,
} from './lineups-match-actions.helpers';
import { fireNominationRemoved } from './lineups-notify-hooks.helpers';
import {
  runCreateLineup,
  runToggleVote,
  runNominate,
} from './lineups-actions.helpers';

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
    private readonly aiSuggestionsCache: AiSuggestionsCacheInvalidator,
  ) {}

  /** Resolve a Discord channel name from its ID via bot cache (ROK-1064). */
  private resolveChannelName = (channelId: string): string | null => {
    const guild = this.botClient.getGuild();
    const channel = guild?.channels?.cache?.get(channelId);
    return channel?.name ?? null;
  };

  /** Create a new lineup (ROK-1065). */
  create(
    dto: CreateLineupDto,
    userId: number,
  ): Promise<LineupDetailResponseDto> {
    return runCreateLineup(
      {
        db: this.db,
        activityLog: this.activityLog,
        settings: this.settings,
        phaseQueue: this.phaseQueue,
        steamNudge: this.steamNudge,
        lineupNotifications: this.lineupNotifications,
        logger: this.logger,
        resolveChannelName: this.resolveChannelName,
      },
      dto,
      userId,
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
  async findActive(): Promise<LineupSummaryResponseDto[]> {
    return buildActiveLineupSummaries(this.db);
  }

  /** Get a lineup by ID with full detail. */
  async findById(
    id: number,
    userId?: number,
  ): Promise<LineupDetailResponseDto> {
    return buildDetailResponse(this.db, id, userId, this.resolveChannelName);
  }

  /** Toggle a vote for a game in a lineup (ROK-936). */
  toggleVote(
    lineupId: number,
    gameId: number,
    userId: number,
    callerRole?: string,
  ): Promise<LineupDetailResponseDto> {
    return runToggleVote(
      {
        db: this.db,
        activityLog: this.activityLog,
        resolveChannelName: this.resolveChannelName,
      },
      lineupId,
      gameId,
      userId,
      callerRole,
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
  ): Promise<LineupDetailResponseDto> {
    const result = await runNominate(
      {
        db: this.db,
        activityLog: this.activityLog,
        lineupNotifications: this.lineupNotifications,
        logger: this.logger,
        resolveChannelName: this.resolveChannelName,
      },
      lineupId,
      dto,
      userId,
      callerRole,
    );
    await this.aiSuggestionsCache.invalidateForLineup(lineupId);
    return result;
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

    await this.aiSuggestionsCache.invalidateForLineup(lineupId);
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

  /**
   * Bandwagon join a match (ROK-937, ROK-1065).
   * `callerRole` is used to enforce the private-lineup eligibility gate
   * (non-invitees may not bandwagon onto a private lineup's match).
   */
  bandwagonJoin(
    lineupId: number,
    matchId: number,
    userId: number,
    callerRole?: string,
  ): Promise<BandwagonJoinResponseDto> {
    return runBandwagonJoin(
      this.db,
      this.lineupNotifications,
      this.logger,
      lineupId,
      matchId,
      userId,
      callerRole,
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
  async addInvitees(
    lineupId: number,
    userIds: number[],
    callerId: number,
  ): Promise<LineupDetailResponseDto> {
    const result = await runAddInvitees(
      this.db,
      this.resolveChannelName,
      lineupId,
      userIds,
      callerId,
    );
    await this.aiSuggestionsCache.invalidateForLineup(lineupId);
    return result;
  }

  /** Remove a single invitee (ROK-1065). */
  async removeInvitee(
    lineupId: number,
    userId: number,
    callerId: number,
  ): Promise<LineupDetailResponseDto> {
    const result = await runRemoveInvitee(
      this.db,
      this.resolveChannelName,
      lineupId,
      userId,
      callerId,
    );
    await this.aiSuggestionsCache.invalidateForLineup(lineupId);
    return result;
  }
}
