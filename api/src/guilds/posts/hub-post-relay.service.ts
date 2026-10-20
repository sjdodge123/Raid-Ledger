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
 *   and classifies errors (warn vs Sentry); it resolves, never rejects.
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

  /** Send one post to the bound channel and record where it landed. */
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
      const messageId = await this.send(record, target, clientUrl);
      await setRelay(this.db, record.post.id, {
        channelId: target.channelId,
        messageId,
        at: new Date(),
      });
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

  private async send(
    record: HubPostRecord,
    target: HubPostRelayTarget,
    clientUrl: string,
  ): Promise<string> {
    const { embed, row } = buildHubPostEmbed({
      guildName: target.guildName,
      authorName: record.author?.displayName ?? record.author?.username ?? null,
      body: record.post.body,
      createdAt: record.post.createdAt,
      deepLink: postDeepLink(clientUrl, target.guildId, record.post.id),
      clientUrl,
    });
    const message = await timedDiscordCall(
      'hubPostRelay',
      () => this.client.sendEmbed(target.channelId, embed, row),
      { channelId: target.channelId },
    );
    return message.id;
  }

  /** 50001/50013/10003/10008 warn; anything else also goes to Sentry. */
  private report(op: 'send' | 'delete', what: string, err: unknown): void {
    this.logger.warn(`Hub post relay ${op} failed for ${what}: ${String(err)}`);
    if (isExpectedRelayError(err)) return;
    Sentry.captureException(err, { tags: { hub_post_relay: op } });
  }
}
