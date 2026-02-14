import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  SettingsService,
  DiscordBotConfig,
  SETTINGS_EVENTS,
} from '../settings/settings.service';
import { friendlyDiscordErrorMessage } from './discord-bot.constants';
import type { DiscordBotStatusResponse } from '@raid-ledger/contract';

@Injectable()
export class DiscordBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordBotService.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) { }

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
    const config = await this.settingsService.getDiscordBotConfig();
    const configured = config !== null;
    const connected = this.clientService.isConnected();
    const connecting = this.clientService.isConnecting();

    const guildInfo = connected ? this.clientService.getGuildInfo() : null;

    return {
      configured,
      connected,
      enabled: config?.enabled,
      connecting,
      guildName: guildInfo?.name,
      memberCount: guildInfo?.memberCount,
    };
  }

  /**
   * Check whether the bot has the required permissions in the guild.
   */
  checkPermissions(): {
    allGranted: boolean;
    permissions: { name: string; granted: boolean }[];
  } {
    const permissions = this.clientService.checkPermissions();
    const allGranted = permissions.every((p) => p.granted);
    return { allGranted, permissions };
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
          : 'Bot token is valid! Almost done — invite the bot to your Discord server using the OAuth2 URL Generator in the Developer Portal.',
      };
    } catch (error) {
      await testClient.disconnect();
      return { success: false, message: friendlyDiscordErrorMessage(error) };
    }
  }
}
