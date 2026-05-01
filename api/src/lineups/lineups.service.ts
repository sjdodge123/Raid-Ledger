import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AbortLineupDto,
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
import { buildGroupedMatchesResponse } from './lineups-match-response.helpers';
import { runMetadataUpdate } from './lineups-metadata.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import { runLineupAbort } from './lineups-abort.helpers';
import { TiebreakerService } from './tiebreaker/tiebreaker.service';
import {
  runBandwagonJoin,
  runAdvanceMatch,
} from './lineups-match-actions.helpers';
import {
  runCreateLineup,
  runToggleVote,
  runNominate,
  runRemoveNomination,
} from './lineups-actions.helpers';
import { maybeAutoAdvance } from './lineups-auto-advance.helpers';
import { LineupsGateway } from './lineups.gateway';

/** Caller identity for authorization checks. */
export interface CallerIdentity {
  id: number;
  role: string;
}

@Injectable()
export class LineupsService {
  private readonly logger = new Logger(LineupsService.name);

  /**
   * Defensive wrapper around `AiSuggestionsCacheInvalidator` calls
   * (ROK-931 reviewer finding). The invalidator already swallows
   * errors in its own implementation, but a test mock or future
   * reimplementation could throw — wrapping at the service boundary
   * guarantees the parent mutation's return value is never blocked
   * by cache hygiene.
   */
  private async invalidateAiCache(lineupId: number): Promise<void> {
    try {
      await this.aiSuggestionsCache.invalidateForLineup(lineupId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `AI suggestions cache invalidation failed for lineup ${lineupId}: ${msg}`,
      );
    }
  }

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
    private readonly lineupsGateway: LineupsGateway,
    @Inject(forwardRef(() => TiebreakerService))
    private readonly tiebreaker: TiebreakerService,
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
  async toggleVote(
    lineupId: number,
    gameId: number,
    userId: number,
    callerRole?: string,
  ): Promise<LineupDetailResponseDto> {
    const result = await runToggleVote(
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
    await maybeAutoAdvance(this.autoAdvanceDeps(), lineupId);
    return result;
  }

  /** Build deps for the auto-advance helper (ROK-1118). */
  private autoAdvanceDeps() {
    return {
      db: this.db,
      activityLog: this.activityLog,
      settings: this.settings,
      phaseQueue: this.phaseQueue,
      lineupNotifications: this.lineupNotifications,
      lineupsGateway: this.lineupsGateway,
      logger: this.logger,
    };
  }

  /** Transition a lineup to a new status. */
  transitionStatus(
    id: number,
    dto: UpdateLineupStatusDto,
  ): Promise<LineupDetailResponseDto> {
    return runStatusTransition(this.autoAdvanceDeps(), id, dto);
  }

  /** ROK-1062: Force-archive a lineup with optional reason (admin/operator). */
  abort(
    id: number,
    dto: AbortLineupDto,
    actor: { id: number },
  ): Promise<LineupDetailResponseDto> {
    return runLineupAbort(
      { ...this.autoAdvanceDeps(), tiebreaker: this.tiebreaker },
      id,
      dto.reason ?? null,
      actor.id,
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
    await this.invalidateAiCache(lineupId);
    await maybeAutoAdvance(this.autoAdvanceDeps(), lineupId);
    return result;
  }

  /** Remove a nomination. */
  async removeNomination(
    lineupId: number,
    gameId: number,
    caller: CallerIdentity,
  ) {
    await runRemoveNomination(
      {
        db: this.db,
        activityLog: this.activityLog,
        lineupNotifications: this.lineupNotifications,
        logger: this.logger,
      },
      lineupId,
      gameId,
      caller,
    );
    await this.invalidateAiCache(lineupId);
    await maybeAutoAdvance(this.autoAdvanceDeps(), lineupId);
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
    await this.invalidateAiCache(lineupId);
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
    await this.invalidateAiCache(lineupId);
    return result;
  }
}
