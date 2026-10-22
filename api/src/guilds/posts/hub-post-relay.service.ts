import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubPostRelayChannel } from '@raid-ledger/contract';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { timedDiscordCall } from '../../discord-bot/services/scheduled-event.helpers';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { findBoundChannelId } from '../guild-discord.queries';
import { buildHubPostEmbed } from './hub-post-relay.embed';
import {
  isExpectedRelayError,
  relayChannelState,
} from './hub-post-relay.discord';
import { postDeepLink } from './hub-posts.helpers';
import { setRelay, type HubPostRecord } from './hub-posts.queries';

/** Where `relay` sends: only built when `availability` said `ok`. */
export interface HubPostRelayTarget {
  guildId: number;
  guildName: string;
  channelId: string;
}

/** What one relay attempt produced (the create flow adds the other two). */
export type HubPostRelaySendOutcome = 'sent' | 'failed';

/**
 * ROK-1868 — the Discord relay of hub posts into the hub's bound channel
 * (ROK-1788 `guild_profiles.discord_channel_id`). Only `HubPostsService.create`
 * calls `relay`, once per post (§2.5 dedup rule 1); the ROK-1832 notification
 * fan-out never posts to a channel.
 *
 * - `availability(guildId)` (D8) never throws.
 * - `relay(record, target)` sends the embed, stores the ids via `setRelay`
 *   and classifies errors (warn vs Sentry); it resolves, never rejects. A
 *   send that outlives the Discord cap answers `failed` on time but still
 *   records its ids when it lands (or unrelays it if the post is gone).
 * - `unrelay(channelId, messageId)` is best effort and never rejects.
 * - `discordGuildId()` feeds the relay `messageUrl` in `toHubPost`.
 */
@Injectable()
export class HubPostRelayService {
  private readonly logger = new Logger(HubPostRelayService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly client: DiscordBotClientService,
    private readonly settings: SettingsService,
  ) {}

  /** The hub's relay channel state (D8); a failing lookup reads `disconnected`. */
  async availability(guildId: number): Promise<HubPostRelayChannel> {
    try {
      const channelId = await findBoundChannelId(this.db, guildId);
      if (!channelId) return { state: 'unset' };
      const guild = this.client.isConnected() ? this.client.getGuild() : null;
      if (!guild) return { state: 'disconnected' };
      return relayChannelState(guild, channelId);
    } catch (err: unknown) {
      this.logger.warn(`Relay availability for ${guildId}: ${String(err)}`);
      return { state: 'disconnected' };
    }
  }

  /**
   * Send one post to the bound channel and record where it landed. The
   * answer is bounded by `timedDiscordCall`, but the ids are persisted off
   * the send itself, so a send that lands after the cap is still recorded.
   */
  async relay(
    record: HubPostRecord,
    target: HubPostRelayTarget,
  ): Promise<HubPostRelaySendOutcome> {
    try {
      const clientUrl = await this.settings.getTrustedClientUrl();
      if (!clientUrl) {
        this.logger.warn('Hub post relay skipped: no client URL configured');
        return 'failed';
      }
      const sending = this.send(record, target, clientUrl);
      const persisted = sending.then((message) =>
        this.persist(record.post.id, target.channelId, message.id),
      );
      void persisted.catch(() => undefined); // observed below or by `watchLate`
      await this.boundedWait(sending, persisted, record.post.id, target);
      await persisted;
      return 'sent';
    } catch (err: unknown) {
      this.report('send', `post ${record.post.id}`, err);
      return 'failed';
    }
  }

  /** Delete a relayed message, best effort (D2); never rejects. */
  async unrelay(channelId: string, messageId: string): Promise<void> {
    try {
      await timedDiscordCall('hubPostUnrelay', () =>
        this.client.deleteMessage(channelId, messageId),
      );
    } catch (err: unknown) {
      this.report('delete', `message ${messageId}`, err);
    }
  }

  /** The bot's Discord guild id, for message URLs (null when offline). */
  discordGuildId(): string | null {
    return this.client.getGuildId();
  }

  /** Start the Discord send (unbounded — `boundedWait` caps the answer). */
  private send(
    record: HubPostRecord,
    target: HubPostRelayTarget,
    clientUrl: string,
  ): Promise<{ id: string }> {
    const { embed, row } = buildHubPostEmbed({
      guildName: target.guildName,
      authorName: record.author?.displayName ?? record.author?.username ?? null,
      body: record.post.body,
      createdAt: record.post.createdAt,
      deepLink: postDeepLink(clientUrl, target.guildId, record.post.id),
      clientUrl,
    });
    return this.client.sendEmbed(target.channelId, embed, row);
  }

  /** Wait at most the Discord cap; on timeout, keep watching the send. */
  private async boundedWait(
    sending: Promise<{ id: string }>,
    persisted: Promise<void>,
    postId: number,
    target: HubPostRelayTarget,
  ): Promise<void> {
    try {
      await timedDiscordCall('hubPostRelay', () => sending, {
        channelId: target.channelId,
      });
    } catch (err: unknown) {
      this.watchLate(persisted, postId, err);
      throw err;
    }
  }

  /** Log a timed-out relay that landed; report a late failure once. */
  private watchLate(
    persisted: Promise<void>,
    postId: number,
    waitErr: unknown,
  ): void {
    void persisted.then(
      () => this.logger.log(`Timed-out hub post relay landed for ${postId}`),
      (lateErr: unknown) => {
        // A send that failed inside the cap is reported by `relay` itself.
        if (lateErr !== waitErr) this.report('send', `post ${postId}`, lateErr);
      },
    );
  }

  /** Store the ids; a post deleted meanwhile gets its message removed. */
  private async persist(
    postId: number,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const at = new Date();
    if (await setRelay(this.db, postId, { channelId, messageId, at })) return;
    this.logger.log(`Hub post ${postId} deleted before its relay landed`);
    await this.unrelay(channelId, messageId);
  }

  /** 50001/50013/10003/10008 warn; anything else also goes to Sentry. */
  private report(op: 'send' | 'delete', what: string, err: unknown): void {
    this.logger.warn(`Hub post relay ${op} failed for ${what}: ${String(err)}`);
    if (isExpectedRelayError(err)) return;
    Sentry.captureException(err, { tags: { hub_post_relay: op } });
  }
}
