/**
 * Orchestrator for Community Lineup Discord notifications (ROK-932).
 * One public method per lifecycle trigger: creation, milestones, voting,
 * decided, scheduling, event creation, and operator removal.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { resolveLineupChannel } from './lineup-notification-channel.helpers';
import type { EmbedContext, NominationEntry, LineupPhase } from './lineup-notification-embed.helpers';
import {
  buildCreatedEmbed,
  buildMilestoneEmbed,
  buildVotingOpenEmbed,
  buildDecidedEmbed,
  buildSchedulingEmbed,
  buildEventCreatedEmbed,
} from './lineup-notification-embed.helpers';
import {
  sendVotingDM,
  sendSchedulingDM,
  sendEventCreatedDM,
} from './lineup-notification-dm.helpers';
import {
  findDiscordLinkedMembers,
  findMatchMemberUsers,
} from './lineup-notification-targets.helpers';

/** Shape of a lineup passed to notification methods. */
export interface LineupInfo {
  id: number;
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

/** TTL for dedup records (7 days). */
const DEDUP_TTL = 7 * 24 * 3600;

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

  /** Resolve shared embed context (baseUrl, community name, phase). */
  private async resolveCtx(lineupId: number, phase: LineupPhase): Promise<EmbedContext> {
    const baseUrl = (await this.settingsService.getClientUrl()) ?? '';
    const community = await this.settingsService.get('community_name');
    return { baseUrl, lineupId, communityName: community ?? 'Raid Ledger', phase };
  }

  /** AC-1: Post channel embed when lineup is created. */
  async notifyLineupCreated(lineup: LineupInfo): Promise<void> {
    const key = `lineup-created:${lineup.id}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(lineup.id, 'nominations');
    const { embed, row } = buildCreatedEmbed(ctx, lineup.targetDate);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  /** AC-2: Post channel embed at nomination milestones (25/50/100%). */
  async notifyNominationMilestone(
    lineupId: number,
    threshold: number,
    entries: NominationEntry[],
  ): Promise<void> {
    const key = `lineup-milestone:${lineupId}:${threshold}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(lineupId, 'nominations');
    const { embed, row } = buildMilestoneEmbed(ctx, threshold, entries);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  /** AC-3: Post channel embed + DMs when voting opens. */
  async notifyVotingOpen(lineup: LineupInfo, games: { id: number; name: string }[]): Promise<void> {
    await this.postVotingChannelEmbed(lineup, games);
    await this.sendVotingDMs(lineup, games.length);
  }

  /** AC-5: Post combined tier embed when matches are found. */
  async notifyMatchesFound(
    lineupId: number,
    matches: MatchInfo[],
  ): Promise<void> {
    const key = `lineup-decided:${lineupId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(lineupId, 'decided');
    const { embed, row } = buildDecidedEmbed(ctx, matches);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  /** AC-6: Send DM to a match member with game + co-players. */
  async notifyMatchMember(
    matchId: number,
    userId: number,
    gameName: string,
    coPlayers: string[],
    lineupId: number,
  ): Promise<void> {
    const key = `lineup-match-dm:${matchId}:${userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const coPlayerList = coPlayers.length ? coPlayers.join(', ') : 'your group';
    await this.notificationService.create({
      userId,
      type: 'community_lineup',
      title: `You're matched for ${gameName}!`,
      message: `You're in a match for ${gameName} with ${coPlayerList}. Schedule a time!`,
      payload: {
        subtype: 'lineup_match_member',
        matchId,
        lineupId,
        gameName,
      },
    });
  }

  /** AC-7: DM to wishlist/heart users for rally-tier games. */
  async notifyRallyInterest(
    matchId: number,
    userId: number,
    gameName: string,
    lineupId: number,
  ): Promise<void> {
    const key = `lineup-rally-dm:${matchId}:${userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    await this.notificationService.create({
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

  /** AC-8: Post per-match channel embed + DMs when scheduling opens. */
  async notifySchedulingOpen(match: MatchInfo): Promise<void> {
    await this.postSchedulingChannelEmbed(match);
    await this.sendSchedulingDMs(match);
  }

  /** AC-10: Post channel embed + DMs when event is created. */
  async notifyEventCreated(match: MatchInfo, eventDate: Date): Promise<void> {
    await this.postEventCreatedChannelEmbed(match, eventDate);
    await this.sendEventCreatedDMs(match, eventDate);
  }

  /** AC-16: DM to nominator when operator removes their nomination. */
  async notifyNominationRemoved(
    lineupId: number,
    gameId: number,
    gameName: string,
    userId: number,
    operatorName: string,
  ): Promise<void> {
    const key = `lineup-removed-dm:${lineupId}:${gameId}:${userId}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    await this.notificationService.create({
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
    });
  }

  // ─── Private: channel embeds ────────────────────────────────

  /** Post the voting-open channel embed. */
  private async postVotingChannelEmbed(
    lineup: LineupInfo,
    games: { id: number; name: string }[],
  ): Promise<void> {
    const key = `lineup-voting:${lineup.id}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(lineup.id, 'voting');
    const { embed, row } = buildVotingOpenEmbed(ctx, games, lineup.votingDeadline);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  /** Post the scheduling-open channel embed for a match. */
  private async postSchedulingChannelEmbed(match: MatchInfo): Promise<void> {
    const key = `lineup-scheduling:${match.id}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(match.lineupId, 'decided');
    const { embed, row } = buildSchedulingEmbed(ctx, match.gameName, match.id);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  /** Post the event-created channel embed. */
  private async postEventCreatedChannelEmbed(
    match: MatchInfo,
    eventDate: Date,
  ): Promise<void> {
    const key = `lineup-event:${match.id}`;
    if (await this.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

    const channelId = await resolveLineupChannel(this.settingsService);
    if (!channelId) return;

    const ctx = await this.resolveCtx(match.lineupId, 'decided');
    const { embed, row } = buildEventCreatedEmbed(ctx, match.gameName, eventDate);
    await this.botClient.sendEmbed(channelId, embed, row);
  }

  // ─── Private: DM dispatch (delegates to helpers) ──────────

  /** Send voting-open DMs to all Discord-linked members. */
  private async sendVotingDMs(
    lineup: LineupInfo,
    gameCount: number,
  ): Promise<void> {
    const members = await findDiscordLinkedMembers(this.db);
    for (const member of members) {
      await sendVotingDM(
        this.notificationService,
        this.dedupService,
        lineup,
        member,
        gameCount,
      );
    }
  }

  /** Send scheduling-open DMs to match members. */
  private async sendSchedulingDMs(match: MatchInfo): Promise<void> {
    const members = await findMatchMemberUsers(this.db, match.id);
    for (const member of members) {
      await sendSchedulingDM(
        this.notificationService,
        this.dedupService,
        match,
        member,
      );
    }
  }

  /** Send event-created DMs to match members. */
  private async sendEventCreatedDMs(
    match: MatchInfo,
    eventDate: Date,
  ): Promise<void> {
    const members = await findMatchMemberUsers(this.db, match.id);
    for (const member of members) {
      await sendEventCreatedDM(
        this.notificationService,
        this.dedupService,
        match,
        member,
        eventDate,
      );
    }
  }
}
