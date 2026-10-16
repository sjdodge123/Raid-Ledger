/**
 * ROK-1788 — read-only mirror of ONE Discord channel for the guild page (S4).
 *
 * Fetch-on-read (D1): a cache miss calls Discord, the result (failures
 * included) is cached in-process for 60s per channel, concurrent misses share
 * one fetch (D5), and nothing is ever written to Postgres or Redis. Callers
 * own the binding; this service only knows channel ids.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  GuildDiscordChannelListDto,
  GuildDiscordChannelOptionDto,
} from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelMirrorCache } from './channel-mirror.cache';
import {
  canMemberView,
  findTextChannel,
  listReadableChannels,
  toMirrorPort,
} from './channel-mirror.discord';
import {
  CHANNEL_MIRROR_TTL_MS,
  buildChannelUrl,
} from './channel-mirror.helpers';
import {
  readChannelMirror,
  type ChannelMirrorRead,
} from './channel-mirror.read';

@Injectable()
export class ChannelMirrorService {
  private readonly logger = new Logger(ChannelMirrorService.name);
  private readonly cache = new ChannelMirrorCache<ChannelMirrorRead>(
    CHANNEL_MIRROR_TTL_MS,
  );

  constructor(private readonly client: DiscordBotClientService) {}

  /** Picker options; `connected:false` + `[]` when the bot is down. */
  listReadableTextChannels(): GuildDiscordChannelListDto {
    const guild = this.client.getGuild();
    if (!guild) return { connected: false, channels: [] };
    return { connected: true, channels: listReadableChannels(guild) };
  }

  /** One bot-readable channel as a picker option, or null (validates a PUT). */
  getReadableChannel(channelId: string): GuildDiscordChannelOptionDto | null {
    const { channels } = this.listReadableTextChannels();
    return channels.find((channel) => channel.id === channelId) ?? null;
  }

  /**
   * Whether the Discord user can view the channel (D7 chooser check). False
   * when the bot is down, the channel is not a text channel, or the user is
   * not a member of the bot's server.
   */
  async canDiscordUserView(
    discordUserId: string,
    channelId: string,
  ): Promise<boolean> {
    const guild = this.client.getGuild();
    if (!guild) return false;
    const channel = findTextChannel(guild, channelId);
    if (!channel) return false;
    return canMemberView(guild, channel, discordUserId);
  }

  /**
   * The latest messages of a channel, cached 60s. Never throws. A down bot is
   * `disconnected` and is NOT cached (checking it is free).
   */
  readLatest(channelId: string): Promise<ChannelMirrorRead> {
    const guild = this.client.getGuild();
    if (!guild) return Promise.resolve({ state: 'disconnected', channelId });
    return this.cache.get(channelId, () =>
      readChannelMirror(toMirrorPort(guild, channelId), {
        channelId,
        discordGuildId: guild.id,
        now: new Date(),
        onError: (error) =>
          this.logger.warn(
            `Channel mirror read failed for ${channelId}: ${String(error)}`,
          ),
      }),
    );
  }

  /** The Open-in-Discord url, or null when the bot is down. */
  channelUrl(channelId: string): string | null {
    const guildId = this.client.getGuildId();
    return guildId === null ? null : buildChannelUrl(guildId, channelId);
  }

  /** Drop a channel's cached read — call for the old AND new id on rebind. */
  clear(channelId: string): void {
    this.cache.clear(channelId);
  }
}
