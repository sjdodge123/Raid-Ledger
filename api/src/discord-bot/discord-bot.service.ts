import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  SettingsService,
  DiscordBotConfig,
  SETTINGS_EVENTS,
} from '../settings/settings.service';
import type { DiscordBotStatusResponse } from '@raid-ledger/contract';

@Injectable()
export class DiscordBotService {
  private readonly logger = new Logger(DiscordBotService.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Auto-connect on startup if configured and enabled.
   */
  async onModuleInit(): Promise<void> {
    try {
      const config = await this.settingsService.getDiscordBotConfig();
      if (config?.enabled) {
        this.logger.log('Discord bot is configured and enabled, connecting...');
        await this.clientService.connect(config.token);
      }
    } catch (error) {
      this.logger.error(
        'Failed to auto-connect Discord bot on startup:',
        error,
      );
    }
  }

  /**
   * Graceful shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    await this.clientService.disconnect();
  }

  /**
   * Hot-reload: reconnect or disconnect when settings change.
   */
  @OnEvent(SETTINGS_EVENTS.DISCORD_BOT_UPDATED)
  async handleConfigUpdate(config: DiscordBotConfig | null): Promise<void> {
    if (!config || !config.enabled) {
      this.logger.log(
        'Discord bot config cleared or disabled, disconnecting...',
      );
      await this.clientService.disconnect();
      return;
    }

    try {
      this.logger.log('Discord bot config updated, reconnecting...');
      await this.clientService.connect(config.token);
    } catch (error) {
      this.logger.error(
        'Failed to reconnect Discord bot after config update:',
        error,
      );
    }
  }

  /**
   * Send a DM to a user by their Discord ID.
   */
  async sendDm(discordId: string, content: string): Promise<void> {
    await this.clientService.sendDirectMessage(discordId, content);
  }

  /**
   * Get current bot status for admin panel.
   */
  async getStatus(): Promise<DiscordBotStatusResponse> {
    const configured = await this.settingsService.isDiscordBotConfigured();
    const connected = this.clientService.isConnected();

    const guildInfo = connected ? this.clientService.getGuildInfo() : null;

    return {
      configured,
      connected,
      guildName: guildInfo?.name,
      memberCount: guildInfo?.memberCount,
    };
  }

  /**
   * Test a bot token by temporarily connecting.
   */
  async testToken(token: string): Promise<{
    success: boolean;
    guildName?: string;
    message: string;
  }> {
    const testClient = new DiscordBotClientService(
      // Create a minimal event emitter that does nothing — test-only
      { emit: () => false } as never,
    );

    try {
      await testClient.connect(token);
      const guildInfo = testClient.getGuildInfo();
      await testClient.disconnect();

      return {
        success: true,
        guildName: guildInfo?.name,
        message: guildInfo
          ? `Connected to ${guildInfo.name} (${guildInfo.memberCount} members)`
          : 'Bot token is valid but not in any guilds',
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to connect with provided token';
      return { success: false, message };
    }
  }
}
