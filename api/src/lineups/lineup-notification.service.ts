/**
 * Orchestrator for Community Lineup Discord notifications (ROK-932).
 * One public method per lifecycle trigger: creation, milestones, voting,
 * decided, scheduling, event creation, and operator removal.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  resolveLineupChannel,
  loadLineupMeta,
} from './lineup-notification-channel.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
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
} from './lineup-notification-dm-batch.helpers';
import {
  findMatchMemberUsers,
  hasExistingPollEmbed,
} from './lineup-notification-targets.helpers';
import { DEDUP_TTL } from './lineup-notification.constants';

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

  private async resolveCtx(
    lineupId: number,
    phase: LineupPhase,
    overrides?: { title?: string; description?: string | null },
  ): Promise<EmbedContext> {
    const baseUrl = (await this.settingsService.getClientUrl()) ?? '';
    const community = await this.settingsService.get('community_name');
    const meta = overrides?.title
      ? overrides
      : await loadLineupMeta(this.db, lineupId);
    return {
      baseUrl,
      lineupId,
      communityName: community ?? 'Raid Ledger',
      phase,
      lineupTitle: meta.title,
      lineupDescription: meta.description ?? null,
    };
  }

  /** AC-1: Post channel embed when lineup is created. */
  async notifyLineupCreated(lineup: LineupInfo): Promise<void> {
    const ctx = await this.resolveCtx(lineup.id, 'nominations', {
      title: lineup.title,
      description: lineup.description ?? null,
    });
    const sent = await this.postChannelEmbed(
      `lineup-created:${lineup.id}`,
      () => buildCreatedEmbed(ctx, lineup.targetDate),
      ctx,
    );
    if (sent) {
      await this.db
        .update(schema.communityLineups)
        .set({
          discordCreatedChannelId: sent.channelId,
          discordCreatedMessageId: sent.messageId,
        })
        .where(eq(schema.communityLineups.id, lineup.id));
    }
  }

  /**
   * Refresh the lineup-created embed after metadata edit (ROK-1063).
   * Edits the original Discord message in place with the new title/description.
   * Silent no-op if no stored message ref (e.g. channel not configured at creation).
   */
  async refreshCreatedEmbed(lineup: LineupInfo): Promise<void> {
    const [row] = await this.db
      .select({
        channelId: schema.communityLineups.discordCreatedChannelId,
        messageId: schema.communityLineups.discordCreatedMessageId,
        targetDate: schema.communityLineups.targetDate,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineup.id))
      .limit(1);
    if (!row?.channelId || !row?.messageId) return;
    const ctx = await this.resolveCtx(lineup.id, 'nominations', {
      title: lineup.title,
      description: lineup.description ?? null,
    });
    const built = buildCreatedEmbed(ctx, row.targetDate ?? undefined);
    try {
      await this.botClient.editEmbed(
        row.channelId,
        row.messageId,
        built.embed,
        built.row,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to edit lineup-created embed for lineup ${lineup.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    await this.postVotingChannelEmbed(lineup, games);
    await this.sendVotingDMs(lineup, games.length);
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
    const coList = coPlayers.length ? coPlayers.join(', ') : 'your group';
    await this.sendDedupedDM(`lineup-match-dm:${matchId}:${userId}`, {
      userId,
      type: 'community_lineup',
      title: `You're matched for ${gameName}!`,
      message: `You're in a match for ${gameName} with ${coList}. Schedule a time!`,
      payload: { subtype: 'lineup_match_member', matchId, lineupId, gameName },
    });
  }

  /** AC-7: DM to wishlist/heart users for rally-tier games. */
  async notifyRallyInterest(
    matchId: number,
    userId: number,
    gameName: string,
    lineupId: number,
  ): Promise<void> {
    await this.sendDedupedDM(`lineup-rally-dm:${matchId}:${userId}`, {
      userId,
      type: 'community_lineup',
      title: `${gameName} needs more interest!`,
      message: `${gameName} almost has enough players. Join the match!`,
      payload: {
        subtype: 'lineup_rally_interest',
        matchId,
        lineupId,
        gameName,
      },
    });
  }

  /** Send a deduped DM via the notification service (ROK-1063 refactor). */
  private async sendDedupedDM(
    dedupKey: string,
    payload: Parameters<NotificationService['create']>[0],
  ): Promise<void> {
    if (await this.dedupService.checkAndMarkSent(dedupKey, DEDUP_TTL)) return;
    await this.notificationService.create(payload);
  }

  /** AC-8: Post per-match channel embed + DMs when scheduling opens. */
  async notifySchedulingOpen(match: MatchInfo): Promise<void> {
    await this.postSchedulingChannelEmbed(match);
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
    const names = members.map((m) => m.displayName);
    await this.postEventCreatedChannelEmbed(match, eventDate, eventId, names);
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
    await this.sendDedupedDM(
      `lineup-removed-dm:${lineupId}:${gameId}:${userId}`,
      {
        userId,
        type: 'community_lineup',
        title: 'Nomination removed',
        message: `Your nomination ${gameName} was removed by ${operatorName}.`,
        payload: {
          subtype: 'lineup_nomination_removed',
          lineupId,
          gameId,
          gameName,
        },
      },
    );
  }

  /** Dedup + resolve channel + post an embed (ROK-1063 refactor). */
  private async postChannelEmbed(
    dedupKey: string,
    build: (
      ctx: EmbedContext,
    ) => Promise<EmbedWithRow | null> | EmbedWithRow | null,
    ctx: EmbedContext,
  ): Promise<{ channelId: string; messageId: string } | null> {
    if (await this.dedupService.checkAndMarkSent(dedupKey, DEDUP_TTL))
      return null;
    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return null;
    const result = await build(ctx);
    if (!result) return null;
    const sent = await this.botClient.sendEmbed(
      channelId,
      result.embed,
      result.row,
    );
    return { channelId, messageId: sent.id };
  }

  /** Post the voting-open channel embed. */
  private async postVotingChannelEmbed(
    lineup: LineupInfo,
    games: { id: number; name: string }[],
  ): Promise<void> {
    const ctx = await this.resolveCtx(lineup.id, 'voting');
    await this.postChannelEmbed(
      `lineup-voting:${lineup.id}`,
      () => buildVotingOpenEmbed(ctx, games, lineup.votingDeadline),
      ctx,
    );
  }

  /** Post the scheduling-open channel embed for a match. */
  private async postSchedulingChannelEmbed(match: MatchInfo): Promise<void> {
    const ctx = await this.resolveCtx(match.lineupId, 'decided');
    await this.postChannelEmbed(
      `lineup-scheduling:${match.id}`,
      async () => {
        if (await hasExistingPollEmbed(this.db, match.id)) return null;
        return buildSchedulingEmbed(ctx, match.gameName, match.id);
      },
      ctx,
    );
  }

  /** Post the event-created channel embed. */
  private async postEventCreatedChannelEmbed(
    match: MatchInfo,
    eventDate: Date,
    eventId: number | undefined,
    memberNames: string[],
  ): Promise<void> {
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
          memberNames,
        ),
      ctx,
    );
  }

  /** Send voting-open DMs to all Discord-linked members. */
  private async sendVotingDMs(
    lineup: LineupInfo,
    gameCount: number,
  ): Promise<void> {
    await fanOutVotingDMs(
      this.db,
      this.notificationService,
      this.dedupService,
      lineup,
      gameCount,
    );
  }
}
