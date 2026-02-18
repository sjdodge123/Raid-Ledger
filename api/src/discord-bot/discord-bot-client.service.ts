import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionsBitField,
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

export interface GuildInfo {
  name: string;
  memberCount: number;
}

export interface PermissionCheckResult {
  name: string;
  granted: boolean;
}

/**
 * The permissions the bot needs to function properly.
 * Maps a human-readable label → discord.js permission flag.
 */
const REQUIRED_PERMISSIONS: { label: string; flag: bigint }[] = [
  { label: 'Manage Roles', flag: PermissionsBitField.Flags.ManageRoles },
  { label: 'Send Messages', flag: PermissionsBitField.Flags.SendMessages },
  { label: 'Embed Links', flag: PermissionsBitField.Flags.EmbedLinks },
  {
    label: 'Read Message History',
    flag: PermissionsBitField.Flags.ReadMessageHistory,
  },
  { label: 'View Channels', flag: PermissionsBitField.Flags.ViewChannel },
];

@Injectable()
export class DiscordBotClientService {
  private readonly logger = new Logger(DiscordBotClientService.name);
  private client: Client | null = null;
  private connecting = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async connect(token: string): Promise<void> {
    // Disconnect any existing client first
    if (this.client) {
      await this.disconnect();
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.connecting = true;

    return new Promise<void>((resolve, reject) => {
      const client = this.client!;

      const timeout = setTimeout(() => {
        this.connecting = false;
        reject(new Error('Discord bot connection timed out after 15s'));
      }, 15_000);

      client.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        this.connecting = false;
        this.logger.log(`Discord bot connected as ${client.user?.tag}`);

        // Warn if bot is in multiple guilds — we only use the first one
        const guildCount = client.guilds.cache.size;
        if (guildCount > 1) {
          this.logger.warn(
            `Bot is in ${guildCount} guilds but only the first one is used. ` +
              `Remove the bot from extra guilds to avoid confusion.`,
          );
        }

        this.eventEmitter.emit(DISCORD_BOT_EVENTS.CONNECTED);
        resolve();
      });

      client.once(Events.Error, (error: Error) => {
        clearTimeout(timeout);
        this.connecting = false;
        const message = friendlyDiscordErrorMessage(error);
        this.logger.error('Discord bot connection error:', message);
        this.eventEmitter.emit(DISCORD_BOT_EVENTS.ERROR, error);
        reject(new Error(message));
      });

      client.login(token).catch((err: unknown) => {
        clearTimeout(timeout);
        this.connecting = false;
        const message = friendlyDiscordErrorMessage(err);
        this.logger.error('Discord bot login failed:', message);
        this.client = null;
        reject(new Error(message));
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connecting = false;

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

  isConnecting(): boolean {
    return this.connecting;
  }

  getGuildInfo(): GuildInfo | null {
    if (!this.client?.isReady()) return null;

    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return null;

      return {
        name: guild.name,
        memberCount: guild.memberCount,
      };
    } catch (error) {
      this.logger.error('Failed to get guild info:', error);
      return null;
    }
  }

  async sendDirectMessage(discordId: string, content: string): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    try {
      const user = await this.client.users.fetch(discordId);
      await user.send(content);
    } catch (error) {
      this.logger.error(`Failed to send DM to ${discordId}:`, error);
      throw error;
    }
  }

  /**
   * Get the guild ID of the first (primary) guild the bot is in.
   */
  getGuildId(): string | null {
    if (!this.client?.isReady()) return null;
    const guild = this.client.guilds.cache.first();
    return guild?.id ?? null;
  }

  /**
   * Send an embed message to a specific channel.
   * @returns The sent Message object for tracking
   */
  async sendEmbed(
    channelId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
  ): Promise<Message> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text channel`);
    }

    const textChannel = channel as TextChannel;
    const messagePayload: {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
    } = { embeds: [embed] };

    if (row) {
      messagePayload.components = [row];
    }

    return textChannel.send(messagePayload);
  }

  /**
   * Edit an existing embed message in a channel.
   */
  async editEmbed(
    channelId: string,
    messageId: string,
    embed: EmbedBuilder,
    row?: ActionRowBuilder<ButtonBuilder>,
  ): Promise<Message> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text channel`);
    }

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(messageId);

    const messagePayload: {
      embeds: EmbedBuilder[];
      components: ActionRowBuilder<ButtonBuilder>[];
    } = {
      embeds: [embed],
      components: row ? [row] : [],
    };

    return message.edit(messagePayload);
  }

  /**
   * Delete a message from a channel.
   */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text channel`);
    }

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(messageId);
    await message.delete();
  }

  /**
   * List text channels from the connected guild.
   */
  getTextChannels(): { id: string; name: string }[] {
    if (!this.client?.isReady()) return [];
    const guild = this.client.guilds.cache.first();
    if (!guild) return [];
    return guild.channels.cache
      .filter((ch) => ch.isTextBased() && !ch.isThread() && !ch.isDMBased())
      .map((ch) => ({ id: ch.id, name: ch.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check whether the bot has every required permission in its guild.
   */
  checkPermissions(): PermissionCheckResult[] {
    if (!this.client?.isReady()) {
      return REQUIRED_PERMISSIONS.map((p) => ({
        name: p.label,
        granted: false,
      }));
    }

    const guild = this.client.guilds.cache.first();
    if (!guild) {
      return REQUIRED_PERMISSIONS.map((p) => ({
        name: p.label,
        granted: false,
      }));
    }

    const me = guild.members.me;
    if (!me) {
      return REQUIRED_PERMISSIONS.map((p) => ({
        name: p.label,
        granted: false,
      }));
    }

    return REQUIRED_PERMISSIONS.map((p) => ({
      name: p.label,
      granted: me.permissions.has(p.flag),
    }));
  }
}
