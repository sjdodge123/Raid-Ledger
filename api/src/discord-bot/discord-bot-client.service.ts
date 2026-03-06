import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isPerfEnabled, perfLog } from '../common/perf-logger';
import {
  type Client,
  type Guild,
  type EmbedBuilder,
  type ActionRowBuilder,
  type ButtonBuilder,
  type TextChannel,
  type Message,
} from 'discord.js';
import {
  DISCORD_BOT_EVENTS,
  friendlyDiscordErrorMessage,
} from './discord-bot.constants';
import {
  REQUIRED_PERMISSIONS,
  createDiscordClient,
  type GuildInfo,
  type PermissionCheckResult,
} from './discord-bot-client.helpers';

export type { GuildInfo, PermissionCheckResult } from './discord-bot-client.helpers';

@Injectable()
export class DiscordBotClientService {
  private readonly logger = new Logger(DiscordBotClientService.name);
  private client: Client | null = null;
  private connecting = false;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async connect(token: string): Promise<void> {
    if (this.client) await this.disconnect();

    const client = createDiscordClient();
    this.client = client;
    this.connecting = true;

    return new Promise<void>((resolve, reject) => {
      this.connectTimeout = setTimeout(() => {
        this.connectTimeout = null;
        this.connecting = false;
        reject(new Error('Discord bot connection timed out after 15s'));
      }, 15_000);

      this.setupReadyHandler(client, resolve);
      this.setupErrorHandler(client, reject);
      this.doLogin(client, token, reject);
    });
  }

  async disconnect(): Promise<void> {
    this.connecting = false;
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (!this.client) return;

    try {
      await this.client.destroy();
      this.logger.log('Discord bot disconnected');
      this.eventEmitter.emit(DISCORD_BOT_EVENTS.DISCONNECTED);
    } catch (error) {
      this.logger.error('Error disconnecting Discord bot:', error);
    } finally {
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client?.isReady() ?? false;
  }

  getClient(): Client | null {
    return this.client;
  }

  isConnecting(): boolean {
    return this.connecting;
  }

  getGuild(): Guild | null {
    if (!this.client?.isReady()) return null;
    return this.client.guilds.cache.first() ?? null;
  }

  getGuildInfo(): GuildInfo | null {
    try {
      const guild = this.getGuild();
      if (!guild) return null;
      return { name: guild.name, memberCount: guild.memberCount };
    } catch (error) {
      this.logger.error('Failed to get guild info:', error);
      return null;
    }
  }

  async sendDirectMessage(
    discordId: string,
    content: string,
  ): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }
    const start = isPerfEnabled() ? performance.now() : 0;
    const user = await this.client.users.fetch(discordId);
    await user.send(content);
    if (start) {
      perfLog('DISCORD', 'sendDirectMessage', performance.now() - start, {
        discordId,
      });
    }
  }

  /** Send a rich embed DM to a user. */
  async sendEmbedDM(
    discordId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
    extraRows?: ActionRowBuilder<ButtonBuilder>[],
  ): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }
    const start = isPerfEnabled() ? performance.now() : 0;
    const user = await this.client.users.fetch(discordId);

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (extraRows) components.push(...extraRows);
    if (row) components.push(row);

    const payload: {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
    } = { embeds: [embed] };
    if (components.length > 0) payload.components = components;

    await user.send(payload);
    if (start) {
      perfLog('DISCORD', 'sendEmbedDM', performance.now() - start, {
        discordId,
      });
    }
  }

  getGuildId(): string | null {
    return this.getGuild()?.id ?? null;
  }

  getClientId(): string | null {
    if (!this.client?.isReady()) return null;
    return this.client.user?.id ?? null;
  }

  /** Send an embed message to a channel. */
  async sendEmbed(
    channelId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
  ): Promise<Message> {
    const channel = await this.fetchTextChannel(channelId);
    const start = isPerfEnabled() ? performance.now() : 0;

    const payload: {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
    } = { embeds: [embed] };
    if (row) payload.components = [row];

    const result = await channel.send(payload);
    if (start) {
      perfLog('DISCORD', 'sendEmbed', performance.now() - start, {
        channelId,
      });
    }
    return result;
  }

  /** Edit an existing embed message in a channel. */
  async editEmbed(
    channelId: string,
    messageId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
  ): Promise<Message> {
    const channel = await this.fetchTextChannel(channelId);
    const start = isPerfEnabled() ? performance.now() : 0;

    const message = await channel.messages.fetch(messageId);
    const result = await message.edit({
      embeds: [embed],
      components: row ? [row] : [],
    });

    if (start) {
      perfLog('DISCORD', 'editEmbed', performance.now() - start, {
        channelId, messageId,
      });
    }
    return result;
  }

  /** Delete a message from a channel. */
  async deleteMessage(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    const start = isPerfEnabled() ? performance.now() : 0;
    const message = await channel.messages.fetch(messageId);
    await message.delete();
    if (start) {
      perfLog('DISCORD', 'deleteMessage', performance.now() - start, {
        channelId, messageId,
      });
    }
  }

  /** List text channels from the guild. */
  getTextChannels(): { id: string; name: string }[] {
    const guild = this.getGuild();
    if (!guild) return [];
    return guild.channels.cache
      .filter((ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased())
      .map((ch) => ({ id: ch.id, name: ch.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** List voice channels from the guild. */
  getVoiceChannels(): { id: string; name: string }[] {
    const guild = this.getGuild();
    if (!guild) return [];
    return guild.channels.cache
      .filter((ch) => ch.isVoiceBased() && !ch.isDMBased())
      .map((ch) => ({ id: ch.id, name: ch.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Search guild members by username query. */
  async searchGuildMembers(
    query: string,
  ): Promise<
    { discordId: string; username: string; avatar: string | null }[]
  > {
    const guild = this.getGuild();
    if (!guild) return [];

    const start = isPerfEnabled() ? performance.now() : 0;
    try {
      const members = await guild.members.fetch({ query, limit: 10 });
      if (start) {
        perfLog('DISCORD', 'searchGuildMembers', performance.now() - start, {
          query,
        });
      }
      return members.map((m) => ({
        discordId: m.user.id,
        username: m.user.username,
        avatar: m.user.avatar,
      }));
    } catch {
      return [];
    }
  }

  /** List guild members (no query required). */
  async listGuildMembers(
    limit = 25,
  ): Promise<
    { discordId: string; username: string; avatar: string | null }[]
  > {
    const guild = this.getGuild();
    if (!guild) return [];

    try {
      const members = await guild.members.list({ limit });
      return members
        .filter((m) => !m.user.bot)
        .map((m) => ({
          discordId: m.user.id,
          username: m.user.username,
          avatar: m.user.avatar,
        }))
        .sort((a, b) => a.username.localeCompare(b.username));
    } catch {
      return [];
    }
  }

  /** Check if a Discord user is in the guild (ROK-403). */
  async isGuildMember(discordUserId: string): Promise<boolean> {
    const guild = this.getGuild();
    if (!guild) return false;

    try {
      const member = await guild.members.fetch(discordUserId);
      return !!member;
    } catch {
      return false;
    }
  }

  /** Check bot permissions in the guild. */
  checkPermissions(): PermissionCheckResult[] {
    const guild = this.getGuild();
    const me = guild?.members.me;
    return REQUIRED_PERMISSIONS.map((p) => ({
      name: p.label,
      granted: me ? me.permissions.has(p.flag) : false,
    }));
  }

  // ─── Private helpers ──────────────────────────────────────

  private setupReadyHandler(
    client: Client,
    resolve: () => void,
  ): void {
    client.once('ready', () => {
      clearTimeout(this.connectTimeout!);
      this.connectTimeout = null;
      this.connecting = false;
      this.logger.log(`Discord bot connected as ${client.user?.tag}`);

      const guildCount = client.guilds.cache.size;
      if (guildCount > 1) {
        this.logger.warn(
          `Bot is in ${guildCount} guilds but only the first one is used.`,
        );
      }

      this.emitConnected().then(resolve, resolve);
    });
  }

  private setupErrorHandler(
    client: Client,
    reject: (err: Error) => void,
  ): void {
    client.once('error', (error: Error) => {
      clearTimeout(this.connectTimeout!);
      this.connectTimeout = null;
      this.connecting = false;
      const message = friendlyDiscordErrorMessage(error);
      this.logger.error('Discord bot connection error:', message);
      this.eventEmitter.emit(DISCORD_BOT_EVENTS.ERROR, error);
      reject(new Error(message));
    });
  }

  private doLogin(
    client: Client,
    token: string,
    reject: (err: Error) => void,
  ): void {
    client.login(token).catch((err: unknown) => {
      clearTimeout(this.connectTimeout!);
      this.connectTimeout = null;
      this.connecting = false;
      const message = friendlyDiscordErrorMessage(err);
      this.logger.error('Discord bot login failed:', message);
      this.client = null;
      reject(new Error(message));
    });
  }

  private async emitConnected(): Promise<void> {
    if (typeof this.eventEmitter.emitAsync === 'function') {
      try {
        await this.eventEmitter.emitAsync(DISCORD_BOT_EVENTS.CONNECTED);
      } catch (err: unknown) {
        this.logger.error(
          'Error in CONNECTED event handlers:',
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      this.eventEmitter.emit(DISCORD_BOT_EVENTS.CONNECTED);
    }
  }

  private async fetchTextChannel(channelId: string): Promise<TextChannel> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    return channel as TextChannel;
  }
}
