import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { DISCORD_BOT_EVENTS } from './discord-bot.constants';

export interface GuildInfo {
  name: string;
  memberCount: number;
}

@Injectable()
export class DiscordBotClientService {
  private readonly logger = new Logger(DiscordBotClientService.name);
  private client: Client | null = null;

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
        GatewayIntentBits.DirectMessages,
      ],
    });

    return new Promise<void>((resolve, reject) => {
      const client = this.client!;

      const timeout = setTimeout(() => {
        reject(new Error('Discord bot connection timed out after 15s'));
      }, 15_000);

      client.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        this.logger.log(`Discord bot connected as ${client.user?.tag}`);
        this.eventEmitter.emit(DISCORD_BOT_EVENTS.CONNECTED);
        resolve();
      });

      client.once(Events.Error, (error: Error) => {
        clearTimeout(timeout);
        this.logger.error('Discord bot connection error:', error);
        this.eventEmitter.emit(DISCORD_BOT_EVENTS.ERROR, error);
        reject(error);
      });

      client.login(token).catch((err: unknown) => {
        clearTimeout(timeout);
        this.logger.error('Discord bot login failed:', err);
        this.client = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async disconnect(): Promise<void> {
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
}
