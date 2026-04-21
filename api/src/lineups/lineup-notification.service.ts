/**
 * Orchestrator for Community Lineup Discord notifications (ROK-932).
 * One public method per lifecycle trigger: creation, milestones, voting,
 * decided, scheduling, event creation, and operator removal.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  persistCreatedEmbedRef,
  loadCreatedEmbedRef,
  editCreatedEmbedSafe,
} from './lineup-notification-refresh.helpers';
import {
  dispatchMatchMemberDM,
  dispatchRallyInterestDM,
  dispatchNominationRemovedDM,
} from './lineup-notification-dms.helpers';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import type {
  EmbedContext,
  NominationEntry,
  LineupPhase,
} from './lineup-notification-embed.helpers';
import {
  buildCreatedEmbed,
  buildMilestoneEmbed,
  buildVotingOpenEmbed,
  buildDecidedEmbed,
  buildSchedulingEmbed,
  buildEventCreatedEmbed,
} from './lineup-notification-embed.helpers';
import {
  fanOutVotingDMs,
  fanOutSchedulingDMs,
  fanOutEventCreatedDMs,
  fanOutMatchMemberDMs,
} from './lineup-notification-dm-batch.helpers';
import {
  routeLineupCreatedIfPrivate,
  routeVotingOpenIfPrivate,
} from './lineup-notification-routing.helpers';
import {
  findMatchMemberUsers,
  hasExistingPollEmbed,
} from './lineup-notification-targets.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';

/** Shape of a lineup passed to notification methods. */
export interface LineupInfo {
  id: number;
  /** Operator-authored title surfaced in every embed (ROK-1063). */
  title?: string;
  /** Operator-authored markdown description (ROK-1063). */
  description?: string | null;
  targetDate?: Date;
  votingDeadline?: Date;
  phaseDeadline?: Date | null;
  /** Per-lineup Discord channel override (ROK-1064). */
  channelOverrideId?: string | null;
  /** Lineup visibility (ROK-1065). 'private' routes to invitee DMs only. */
  visibility?: 'public' | 'private';
}

/** Shape of a match passed to notification methods. */
export interface MatchInfo {
  id: number;
  lineupId: number;
  gameId: number;
  gameName: string;
  status: string;
  thresholdMet: boolean;
  voteCount: number;
  linkedEventId?: number;
}

@Injectable()
export class LineupNotificationService {
  private readonly logger = new Logger(LineupNotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly botClient: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  private get dispatchDeps(): DispatchDeps {
    const { db, settingsService, botClient, dedupService } = this;
    return { db, settingsService, botClient, dedupService };
  }

  private resolveCtx(
    lineupId: number,
    phase: LineupPhase,
    overrides?: { title?: string; description?: string | null },
  ): Promise<EmbedContext> {
    return resolveEmbedCtx(this.dispatchDeps, lineupId, phase, overrides);
  }

  /** AC-1: Post channel embed when lineup is created. */
  async notifyLineupCreated(lineup: LineupInfo): Promise<void> {
    const routedPrivate = await routeLineupCreatedIfPrivate(
      this.db,
      this.notificationService,
      this.dedupService,
      lineup,
    );
    if (routedPrivate) return;
    const ctx = await this.resolveCtx(lineup.id, 'nominations', {
      title: lineup.title,
      description: lineup.description ?? null,
    });
    const sent = await this.postChannelEmbed(
      `lineup-created:${lineup.id}`,
      () => buildCreatedEmbed(ctx, lineup.targetDate),
      ctx,
      lineup.channelOverrideId,
    );
    if (sent) {
      await persistCreatedEmbedRef(
        this.db,
        lineup.id,
        sent.channelId,
        sent.messageId,
      );
    }
  }

  /**
   * Refresh the lineup-created embed after metadata edit (ROK-1063).
   * Edits the original Discord message in place with the new title/description.
   * Silent no-op if no stored message ref (e.g. channel not configured at creation).
   */
  async refreshCreatedEmbed(lineup: LineupInfo): Promise<void> {
    const ref = await loadCreatedEmbedRef(this.db, lineup.id);
    if (!ref) return;
    const ctx = await this.resolveCtx(lineup.id, 'nominations', {
      title: lineup.title,
      description: lineup.description ?? null,
    });
    const built = buildCreatedEmbed(ctx, ref.targetDate ?? undefined);
    await editCreatedEmbedSafe(
      this.botClient,
      this.logger,
      lineup.id,
      ref,
      built.embed,
      built.row,
    );
  }

  /** AC-2: Post channel embed at nomination milestones (25/50/100%). */
  async notifyNominationMilestone(
    lineupId: number,
    threshold: number,
    entries: NominationEntry[],
  ): Promise<void> {
    const ctx = await this.resolveCtx(lineupId, 'nominations');
    await this.postChannelEmbed(
      `lineup-milestone:${lineupId}:${threshold}`,
      () => buildMilestoneEmbed(ctx, threshold, entries),
      ctx,
    );
  }

  /** AC-3: Post channel embed + DMs when voting opens. */
  async notifyVotingOpen(
    lineup: LineupInfo,
    games: { id: number; name: string }[],
  ): Promise<void> {
    const clientUrl = await this.settingsService.getClientUrl();
    const routedPrivate = await routeVotingOpenIfPrivate(
      this.db,
      this.notificationService,
      this.dedupService,
      lineup,
      games,
      clientUrl,
    );
    if (routedPrivate) return;
    const ctx = await this.resolveCtx(lineup.id, 'voting');
    await this.postChannelEmbed(
      `lineup-voting:${lineup.id}`,
      () => buildVotingOpenEmbed(ctx, games, lineup.votingDeadline),
      ctx,
    );
    await fanOutVotingDMs(
      this.db,
      this.notificationService,
      this.dedupService,
      lineup,
      games,
      clientUrl,
    );
  }

  /** AC-5: Post combined tier embed + per-member DMs when matches are found. */
  async notifyMatchesFound(
    lineupId: number,
    matches: MatchInfo[],
  ): Promise<void> {
    const ctx = await this.resolveCtx(lineupId, 'decided');
    await this.postChannelEmbed(
      `lineup-decided:${lineupId}`,
      () => buildDecidedEmbed(ctx, matches),
      ctx,
    );
    await fanOutMatchMemberDMs(
      this.db,
      this.notificationService,
      this.dedupService,
      lineupId,
      matches,
    );
  }

  /** AC-6: Send DM to a match member with game + co-players. */
  async notifyMatchMember(
    matchId: number,
    userId: number,
    gameName: string,
    coPlayers: string[],
    lineupId: number,
  ): Promise<void> {
    await dispatchMatchMemberDM(this.dedupService, this.notificationService, {
      matchId,
      userId,
      gameName,
      coPlayers,
      lineupId,
    });
  }

  /** AC-7: DM to wishlist/heart users for rally-tier games. */
  async notifyRallyInterest(
    matchId: number,
    userId: number,
    gameName: string,
    lineupId: number,
  ): Promise<void> {
    await dispatchRallyInterestDM(this.dedupService, this.notificationService, {
      matchId,
      userId,
      gameName,
      lineupId,
    });
  }

  /** AC-8: Post per-match channel embed + DMs when scheduling opens. */
  async notifySchedulingOpen(match: MatchInfo): Promise<void> {
    const ctx = await this.resolveCtx(match.lineupId, 'decided');
    await this.postChannelEmbed(
      `lineup-scheduling:${match.id}`,
      async () => {
        if (await hasExistingPollEmbed(this.db, match.id)) return null;
        return buildSchedulingEmbed(ctx, match.gameName, match.id);
      },
      ctx,
    );
    await fanOutSchedulingDMs(
      this.db,
      this.notificationService,
      this.dedupService,
      match,
    );
  }

  /** AC-10: Post channel embed + DMs when event is created. */
  async notifyEventCreated(
    match: MatchInfo,
    eventDate: Date,
    eventId?: number,
  ): Promise<void> {
    const members = await findMatchMemberUsers(this.db, match.id);
    const ctx = await this.resolveCtx(match.lineupId, 'decided');
    await this.postChannelEmbed(
      `lineup-event:${match.id}`,
      () =>
        buildEventCreatedEmbed(
          ctx,
          match.gameName,
          match.gameId,
          eventDate,
          eventId,
          members.map((m) => m.displayName),
        ),
      ctx,
    );
    await fanOutEventCreatedDMs(
      this.notificationService,
      this.dedupService,
      match,
      eventDate,
      eventId,
      members,
    );
  }

  /** AC-16: DM to nominator when operator removes their nomination. */
  async notifyNominationRemoved(
    lineupId: number,
    gameId: number,
    gameName: string,
    userId: number,
    operatorName: string,
  ): Promise<void> {
    await dispatchNominationRemovedDM(
      this.dedupService,
      this.notificationService,
      { lineupId, gameId, gameName, userId, operatorName },
    );
  }

  private postChannelEmbed(
    dedupKey: string,
    build: Parameters<typeof postChannelEmbed>[2],
    ctx: EmbedContext,
    overrideId?: string | null,
  ): ReturnType<typeof postChannelEmbed> {
    return postChannelEmbed(
      this.dispatchDeps,
      dedupKey,
      build,
      ctx,
      overrideId,
    );
  }
}
