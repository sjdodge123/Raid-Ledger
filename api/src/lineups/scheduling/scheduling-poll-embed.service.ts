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
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordEmbedFactory } from '../../discord-bot/services/discord-embed.factory';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { resolveLineupChannel } from '../lineup-notification-channel.helpers';
import {
  LINEUP_MATCH_EVENTS,
  type MatchEnteredSchedulingPayload,
  type PollCardsOrphanedPayload,
} from '../lineups-scheduling-hook.helpers';
import { deleteOrphanedPollCards } from './scheduling-poll-orphan.helpers';
import {
  loadMatchForInitialPost,
  claimEmbedSlot,
  releaseEmbedClaim,
} from './scheduling-poll-post.helpers';
import { resolveLineupVisibility } from '../lineup-notification-routing.helpers';
import { SchedulingPollEmbedQueueService } from './scheduling-poll-embed.queue';
import { LineupsGateway } from '../lineups.gateway';
import {
  SchedulingPollForumCard,
  pollStarterCard,
} from './scheduling-poll-forum-card';
import {
  POLL_FORUM_STARTER_PORT,
  type PollForumStarterPort,
} from './poll-forum-starter.port';
import type { ForumStarterCard } from '../../discord-bot/services/event-embed-message.editor';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class SchedulingPollEmbedService {
  private readonly logger = new Logger(SchedulingPollEmbedService.name);
  /** ROK-2295: one render path for the channel card and the forum starter. */
  private readonly card: SchedulingPollForumCard;
  private starterPort: PollForumStarterPort | undefined;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    embedFactory: DiscordEmbedFactory,
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
    /** ROK-2295: resolves the forum module's poll-starter port lazily. */
    private readonly moduleRef?: ModuleRef,
  ) {
    this.card = new SchedulingPollForumCard(db, embedFactory, settingsService);
  }

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
   * A re-decide wiped matches that owned poll cards (TDB:571): delete the
   * cards so no live poll points at a match that no longer exists.
   * Fire-and-forget, like the entered-scheduling listener above.
   *
   * @param payload - The cards the committed wipe orphaned.
   */
  @OnEvent(LINEUP_MATCH_EVENTS.POLL_CARDS_ORPHANED)
  onPollCardsOrphaned(payload: PollCardsOrphanedPayload): void {
    void deleteOrphanedPollCards(
      this.clientService,
      payload.cards,
      this.logger,
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
      if (!(await this.storeRefOrDropCard(matchId, messageId, target))) return;
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
    const embed = await this.card.render({ matchId, lineupId, gameId });
    if (!embed) return null;
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
   * ROK-2295: the poll's forum post (hub or non-hub) opens with the same
   * embed, and a poll with a post often has NO channel card — so the starter
   * edit runs before that early return, from the one render.
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
    const embed = await this.card.renderMatch(match);
    if (!embed) return;
    await this.syncForumStarter(matchId, pollStarterCard(embed));
    if (!match.embedMessageId || !match.embedChannelId) return;
    await this.clientService.editEmbed(
      match.embedChannelId,
      match.embedMessageId,
      embed,
    );
  }

  /** ROK-2295: best effort — a starter failure never fails the card sync. */
  private async syncForumStarter(
    matchId: number,
    card: ForumStarterCard,
  ): Promise<void> {
    try {
      await this.forumStarterPort()?.syncStarter(matchId, card);
    } catch (err) {
      this.logger.warn(
        `Poll ${matchId} forum starter edit failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** The forum module's port; null when it is not bound (e.g. a slim app). */
  private forumStarterPort(): PollForumStarterPort | null {
    try {
      this.starterPort ??= this.moduleRef?.get<PollForumStarterPort>(
        POLL_FORUM_STARTER_PORT,
        { strict: false },
      );
    } catch {
      return null;
    }
    return this.starterPort ?? null;
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
   * Store the ref for a card that just landed (TDB:571). A re-decide that
   * wiped the match mid-send leaves no row to store it on, so the card is
   * deleted — otherwise it stays live pointing at a match that is gone.
   *
   * @returns False when the card was dropped; the caller skips the refresh.
   */
  private async storeRefOrDropCard(
    matchId: number,
    messageId: string,
    channelId: string,
  ): Promise<boolean> {
    if (await this.storeEmbedRef(matchId, messageId, channelId)) return true;
    const card = { channelId, messageId };
    await deleteOrphanedPollCards(this.clientService, [card], this.logger);
    return false;
  }

  /**
   * Store the Discord message reference on the match row.
   *
   * @returns False when no row matched — the match was deleted mid-send.
   */
  private async storeEmbedRef(
    matchId: number,
    messageId: string,
    channelId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(schema.communityLineupMatches)
      .set({ embedMessageId: messageId, embedChannelId: channelId })
      .where(eq(schema.communityLineupMatches.id, matchId))
      .returning({ id: schema.communityLineupMatches.id });
    return rows.length > 0;
  }
}
