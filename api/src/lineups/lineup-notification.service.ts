/**
 * Orchestrator for Community Lineup Discord notifications (ROK-932).
 * One public method per lifecycle trigger: creation, milestones, voting,
 * decided, scheduling, event creation, and operator removal.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
  fanOutVotingDMsToInvitees,
  fanOutLineupCreatedDMsToInvitees,
  fanOutSchedulingDMs,
  fanOutEventCreatedDMs,
} from './lineup-notification-dm-batch.helpers';
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
    return {
      db: this.db,
      settingsService: this.settingsService,
      botClient: this.botClient,
      dedupService: this.dedupService,
    };
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
    const visibility = await this.resolveVisibility(lineup);
    // ROK-1065: private lineups skip the channel embed and DM invitees.
    if (visibility === 'private') {
      await fanOutLineupCreatedDMsToInvitees(
        this.db,
        this.notificationService,
        this.dedupService,
        lineup,
      );
      return;
    }
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
   * Resolve lineup visibility: prefer the caller-provided value, fall back
   * to a DB lookup so older callers aren't broken (ROK-1065).
   */
  private async resolveVisibility(
    lineup: LineupInfo,
  ): Promise<'public' | 'private'> {
    if (lineup.visibility) return lineup.visibility;
    const [row] = await this.db
      .select({ visibility: schema.communityLineups.visibility })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineup.id))
      .limit(1);
    return row?.visibility ?? 'public';
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
    const visibility = await this.resolveVisibility(lineup);
    const clientUrl = await this.settingsService.getClientUrl();
    // ROK-1065: private lineups skip the channel embed and DM invitees only.
    if (visibility === 'private') {
      await fanOutVotingDMsToInvitees(
        this.db,
        this.notificationService,
        this.dedupService,
        lineup,
        games,
        clientUrl,
      );
      return;
    }
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
    await this.sendMatchMemberDMs(lineupId, matches);
  }

  /** Send DMs to each member of each match (M is typically 3-5). */
  private async sendMatchMemberDMs(lineupId: number, matches: MatchInfo[]) {
    for (const match of matches) {
      const members = await findMatchMemberUsers(this.db, match.id);
      const names = members.map((m) => m.displayName);
      for (const member of members) {
        const coPlayers = names.filter((n) => n !== member.displayName);
        await this.notifyMatchMember(
          match.id,
          member.userId,
          match.gameName,
          coPlayers,
          lineupId,
        );
      }
    }
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
