/**
 * Scheduling Poll Embed Service (ROK-1014).
 * Handles posting and updating the live Discord embed for scheduling polls.
 * Both operations are fire-and-forget with error logging.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../../discord-bot/services/discord-embed.factory';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { resolveLineupChannel } from '../lineup-notification-channel.helpers';
import {
  LINEUP_MATCH_EVENTS,
  type MatchEnteredSchedulingPayload,
} from '../lineups-scheduling-hook.helpers';
import {
  loadMatchForInitialPost,
  claimEmbedSlot,
  releaseEmbedClaim,
} from './scheduling-poll-post.helpers';
import { resolveLineupVisibility } from '../lineup-notification-routing.helpers';
import {
  findScheduleSlots,
  findScheduleVotes,
} from './scheduling-query.helpers';
import {
  buildEmbedSlots,
  buildPollUrl,
  pollStatusFromMatch,
} from './scheduling-poll-embed.helpers';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class SchedulingPollEmbedService {
  private readonly logger = new Logger(SchedulingPollEmbedService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly clientService: DiscordBotClientService,
    private readonly channelResolver: ChannelResolverService,
    private readonly settingsService: SettingsService,
    /** ROK-1473: warn-once dedup for a broken per-lineup channel override. */
    private readonly dedupService: NotificationDedupService,
  ) {}

  /**
   * A community-lineup match entered the scheduling phase (ROK-1473).
   *
   * The only listener for {@link LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING} —
   * both flip sites (matching algorithm, bandwagon/operator promotion) reach
   * the poll card through here. Fire-and-forget by design: a Discord failure
   * is logged and never propagates back into the phase change.
   *
   * @param payload - The match that entered scheduling.
   */
  @OnEvent(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING)
  onMatchEnteredScheduling(payload: MatchEnteredSchedulingPayload): void {
    void this.postCardForMatch(payload.matchId).catch((err) =>
      this.logger.warn(
        `Failed to post scheduling poll card for match ${payload.matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  /**
   * Post the card for a match that just entered scheduling.
   *
   * Skips when a card already exists (re-entry, retry) and routes to the
   * LINEUP's channel — override → admin lineup channel → default announcement
   * channel — rather than the game channel a standalone poll uses.
   */
  private async postCardForMatch(matchId: number): Promise<void> {
    const match = await loadMatchForInitialPost(this.db, matchId);
    if (!match || match.embedMessageId) return;
    // ROK-1473 review: a private lineup DMs its invitees (`notifySchedulingOpen`
    // routes that) and posts NO channel embed — the poll card must not leak
    // the game or the poll URL into a public channel. `null` (lineup row gone)
    // fails closed, same as every other routed lineup notification.
    const visibility = await resolveLineupVisibility(this.db, {
      id: match.lineupId,
    });
    if (visibility !== 'public') return;
    const channelId = await resolveLineupChannel(
      this.settingsService,
      this.clientService,
      this.dedupService,
      match.lineupId,
      match.channelOverrideId,
    );
    if (!channelId) {
      this.logger.warn(
        `No lineup channel for match ${matchId} (lineup ${match.lineupId}); poll card skipped`,
      );
      return;
    }
    await this.postInitialEmbed(
      matchId,
      match.lineupId,
      match.gameId,
      channelId,
    );
  }

  /** Fire-and-forget: post initial embed to Discord channel. */
  firePostInitialEmbed(
    match: { id: number; gameId: number },
    lineupId: number,
    gameId: number,
  ): void {
    void this.postInitialEmbed(match.id, lineupId, gameId).catch((err) =>
      this.logger.error('Failed to post scheduling poll embed', err),
    );
  }

  /** Fire-and-forget: update existing embed with latest votes. */
  fireUpdateEmbed(matchId: number): void {
    void this.updateEmbed(matchId).catch((err) =>
      this.logger.error('Failed to update scheduling poll embed', err),
    );
  }

  /**
   * Post the initial scheduling poll embed.
   *
   * @param channelId - ROK-1473: pre-resolved LINEUP channel. Omitted by the
   * standalone-poll path, which keeps the game-channel resolution.
   */
  private async postInitialEmbed(
    matchId: number,
    lineupId: number,
    gameId: number,
    channelId?: string,
  ): Promise<void> {
    const target =
      channelId ?? (await this.channelResolver.resolveChannelForEvent(gameId));
    if (!target) return;
    // ROK-1473 (D3): claim the slot with one conditional UPDATE. Only the
    // winner sends, so a retry, a concurrent flip, a re-decide that deleted
    // the match, or a lock-in that moved it on cannot post a stale card.
    if (!(await claimEmbedSlot(this.db, matchId, target))) return;
    let messageId: string | null = null;
    try {
      messageId = await this.sendClaimedEmbed(
        matchId,
        lineupId,
        gameId,
        target,
      );
    } finally {
      // Release ONLY when nothing reached Discord. A failure AFTER the send
      // (e.g. the store write) must keep the claim: re-opening the slot would
      // let the next delivery post a duplicate next to the card that landed.
      if (messageId === null) await releaseEmbedClaim(this.db, matchId);
    }
    if (messageId !== null) {
      await this.storeEmbedRef(matchId, messageId, target);
    }
  }

  /**
   * Build + send the card for a claimed slot.
   *
   * @returns The Discord message id, or null when there was nothing to send
   * (the game row vanished) — the caller then releases the claim.
   */
  private async sendClaimedEmbed(
    matchId: number,
    lineupId: number,
    gameId: number,
    channelId: string,
  ): Promise<string | null> {
    const data = await this.buildEmbedData(matchId, lineupId, gameId);
    if (!data) return null;
    const { embed } = this.embedFactory.buildSchedulingPollEmbed(
      data,
      await this.buildContext(),
    );
    const msg = await this.clientService.sendEmbed(channelId, embed);
    return msg.id;
  }

  /** Update the existing embed with latest vote data. */
  private async updateEmbed(matchId: number): Promise<void> {
    const [match] = await this.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    if (!match?.embedMessageId || !match.embedChannelId) return;
    // ROK-1461: the match row carries the lifecycle the embed renders, so a
    // lock-in or an archive re-render flips the author line and the colour.
    const status = pollStatusFromMatch(match.status);
    const data = await this.buildEmbedData(
      matchId,
      match.lineupId,
      match.gameId,
      status,
      await this.loadLockedInTime(match.linkedEventId, status),
    );
    if (!data) return;
    const { embed } = this.embedFactory.buildSchedulingPollEmbed(
      data,
      await this.buildContext(),
    );
    await this.clientService.editEmbed(
      match.embedChannelId,
      match.embedMessageId,
      embed,
    );
  }

  /**
   * Shared embed context from settings (ROK-1461, operator walk 2026-09-02).
   *
   * The poll used to pass `clientUrl` ALONE, so the chrome fell back to
   * `DEFAULT_COMMUNITY_NAME` and the poll footer read `Raid Ledger · …` while
   * the lineup card next to it read the configured community name. Mirrors
   * `embed-sync.processor.ts::buildContext` — same branding source, so the two
   * families cannot drift apart again.
   *
   * @returns Community name, web origin and timezone for the poll embed.
   */
  private async buildContext(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }

  /** Build embed data from current DB state. */
  private async buildEmbedData(
    matchId: number,
    lineupId: number,
    gameId: number,
    status: SchedulingPollStatus = 'open',
    lockedInTime: string | null = null,
  ) {
    const [game] = await this.db
      .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    if (!game) return null;
    const slots = await findScheduleSlots(this.db, matchId);
    const slotIds = slots.map((s) => s.id);
    const votes = await findScheduleVotes(this.db, slotIds);
    const clientUrl = await this.settingsService.getClientUrl();
    return {
      matchId,
      lineupId,
      gameId,
      status,
      lockedInTime,
      gameName: game.name,
      gameCoverUrl: game.coverUrl,
      pollUrl: buildPollUrl(clientUrl, lineupId, matchId),
      slots: buildEmbedSlots(slots, votes),
      uniqueVoterCount: new Set(votes.map((v) => v.userId)).size,
    };
  }

  /**
   * ISO start time of the event a lock-in produced (ROK-1461 review
   * follow-up). Lock-in may select a slot that is NOT the top-voted one, so
   * the linked event's start is the only trustworthy "locked in at" value.
   *
   * @param linkedEventId - The match's linked event, when it has one.
   * @param status - The poll status the embed is about to render.
   * @returns The ISO start time, or null when there is nothing to announce.
   */
  private async loadLockedInTime(
    linkedEventId: number | null,
    status: SchedulingPollStatus,
  ): Promise<string | null> {
    if (status !== 'locked_in' || !linkedEventId) return null;
    // `events.duration` is a tsrange — its lower bound is the start time.
    const [event] = await this.db
      .select({ startTime: sql<string>`lower(${schema.events.duration})` })
      .from(schema.events)
      .where(eq(schema.events.id, linkedEventId))
      .limit(1);
    return event?.startTime ? new Date(event.startTime).toISOString() : null;
  }

  /** Store the Discord message reference on the match row. */
  private async storeEmbedRef(
    matchId: number,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    await this.db
      .update(schema.communityLineupMatches)
      .set({ embedMessageId: messageId, embedChannelId: channelId })
      .where(eq(schema.communityLineupMatches.id, matchId));
  }
}
