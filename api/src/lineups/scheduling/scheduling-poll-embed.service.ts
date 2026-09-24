/**
 * Scheduling Poll Embed Service (ROK-1014).
 * Handles posting and updating the live Discord embed for scheduling polls.
 * The initial post is fire-and-forget with error logging. Updates (ROK-1549)
 * go through the debounced `scheduling-poll-embed-sync` queue: the processor
 * calls {@link SchedulingPollEmbedService.syncEmbed}, retries with backoff and
 * reports the final failure to Sentry. `fireUpdateEmbed` tells open web pages
 * the poll changed right away (`lineup:schedule-changed`, ROK-1551/ROK-1683);
 * each sync repeats it as a trailing nudge.
 *
 * CI: this directory is under the discord-smoke path filter (ROK-1547) — an
 * embed-affecting change here runs the companion-bot smoke suite on the PR.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
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
import { pollStatusFromMatch } from './scheduling-poll-embed.helpers';
import { findScheduleSlots } from './scheduling-query.helpers';
import {
  loadEmbedData,
  loadLineupLifecycle,
  loadLockedInTime,
  type EmbedDataInput,
} from './scheduling-poll-embed-data.helpers';
import { SchedulingPollEmbedQueueService } from './scheduling-poll-embed.queue';
import { LineupsGateway } from '../lineups.gateway';
import type { SchedulingPollEmbedData } from '../../discord-bot/services/discord-embed-scheduling.types';

type Db = PostgresJsDatabase<typeof schema>;
type MatchRow = typeof schema.communityLineupMatches.$inferSelect;

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
    /** ROK-1549: debounced producer for card re-renders. */
    private readonly embedQueue: SchedulingPollEmbedQueueService,
    /** ROK-1551: tells open poll pages to refetch. */
    @Inject(forwardRef(() => LineupsGateway))
    private readonly lineupsGateway: LineupsGateway,
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

  /**
   * Tell open poll pages the poll changed, then schedule a card re-render
   * (ROK-1549 S1-AC1, ROK-1683).
   *
   * The page nudge goes out NOW, independent of the card job: that job
   * coalesces (2s window, reset per change) and queues behind every other
   * poll's rate-limited Discord edit, so a vote could reach open pages 10s+
   * late. Callers invoke this after their write commits. The enqueue is a
   * coalesced job — a burst of votes inside the window is one Discord edit.
   * Never throws: the nudge logs its own failures, the producer reports its.
   *
   * @param matchId - The poll's match id.
   */
  fireUpdateEmbed(matchId: number): void {
    void this.nudgeOpenPages(matchId);
    void this.embedQueue.enqueue(matchId);
  }

  /** ROK-1683: one PK read for the lineup, then the socket nudge. */
  private async nudgeOpenPages(matchId: number): Promise<void> {
    try {
      const [row] = await this.db
        .select({ lineupId: schema.communityLineupMatches.lineupId })
        .from(schema.communityLineupMatches)
        .where(eq(schema.communityLineupMatches.id, matchId))
        .limit(1);
      if (row) this.emitScheduleChanged(row.lineupId, matchId);
    } catch (err) {
      this.logger.warn(
        `Failed to nudge open poll pages for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
      // ROK-1554: a suggestion or vote that landed while Discord was still
      // acknowledging the post was dropped by `updateEmbed` (no message id
      // yet) and nothing re-synced the card. Re-render once from fresh data.
      await this.syncEmbed(matchId).catch((err) =>
        this.logger.warn(
          `Post-send refresh failed for scheduling poll card ${matchId}: ${String(err)}`,
        ),
      );
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
    const data = await this.buildEmbedData({ matchId, lineupId, gameId });
    if (!data) return null;
    const { embed } = this.embedFactory.buildSchedulingPollEmbed(
      data,
      await this.buildContext(),
    );
    const msg = await this.clientService.sendEmbed(channelId, embed);
    return msg.id;
  }

  /**
   * Re-render the poll card from current DB state (ROK-1549 queue target).
   *
   * Emits `lineup:schedule-changed` BEFORE the no-card early return, so web
   * freshness does not depend on the poll having a Discord card (private
   * lineups have none). ROK-1683: `fireUpdateEmbed` already nudged; this is
   * the trailing nudge, and the only one on the initial-post path.
   *
   * @param matchId - The poll's match id.
   * @throws Any render / `editEmbed` failure — the processor retries.
   */
  async syncEmbed(matchId: number): Promise<void> {
    const [match] = await this.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    if (!match) return;
    this.emitScheduleChanged(match.lineupId, matchId);
    if (!match.embedMessageId || !match.embedChannelId) return;
    const data = await this.loadSyncData(match);
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
   * Lifecycle-aware render data for an existing card.
   *
   * ROK-1461: the match row carries the lifecycle the embed renders.
   * ROK-1545 (review F2): the page reads the parent lineup's status +
   * deadline, so the embed must too — ONE helper, the same inputs, one answer.
   */
  private async loadSyncData(
    match: MatchRow,
  ): Promise<SchedulingPollEmbedData | null> {
    const [lineup, slots] = await Promise.all([
      loadLineupLifecycle(this.db, match.lineupId),
      findScheduleSlots(this.db, match.id),
    ]);
    const status = pollStatusFromMatch({
      matchStatus: match.status,
      lineupStatus: lineup?.status ?? null,
      phaseDeadline: lineup?.phaseDeadline ?? null,
      linkedEventId: match.linkedEventId,
      // ROK-1607: a card whose every time has passed is not open, however
      // much of the deadline is left.
      slotTimes: slots.map((s) => s.proposedTime),
    });
    return this.buildEmbedData({
      matchId: match.id,
      lineupId: match.lineupId,
      gameId: match.gameId,
      status,
      lockedInTime: await loadLockedInTime(
        this.db,
        match.linkedEventId,
        status,
      ),
      deadline: lineup?.phaseDeadline?.toISOString() ?? null,
      cancelReason: match.cancellationReason ?? null,
    });
  }

  /** Socket nudge for open poll pages; a socket failure never fails the sync. */
  private emitScheduleChanged(lineupId: number, matchId: number): void {
    try {
      this.lineupsGateway.emitScheduleChanged(lineupId, matchId);
    } catch (err) {
      this.logger.warn(
        `Failed to emit schedule-changed for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    input: Omit<EmbedDataInput, 'clientUrl'>,
  ): Promise<SchedulingPollEmbedData | null> {
    const clientUrl = await this.settingsService.getClientUrl();
    return loadEmbedData(this.db, { ...input, clientUrl });
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
