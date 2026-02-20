import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';

/**
 * Resolves which Discord channel to post event embeds to.
 *
 * Channel resolution priority (design spec section 4.3):
 * 1. Game-specific channel binding (ROK-348)
 * 2. Default text channel from bot settings (ROK-349)
 * 3. null — skip posting with logged warning
 */
@Injectable()
export class ChannelResolverService {
  private readonly logger = new Logger(ChannelResolverService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
  ) {}

  /**
   * Resolve the target Discord channel for an event.
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @returns Channel ID string or null if no channel configured
   */
  async resolveChannelForEvent(gameId?: number | null): Promise<string | null> {
    // Priority 1: Game-specific binding
    if (gameId) {
      const guildId = this.clientService.getGuildId();
      if (guildId) {
        const boundChannel =
          await this.channelBindingsService.getChannelForGame(guildId, gameId);
        if (boundChannel) {
          return boundChannel;
        }
      }
    }

    // Priority 2: Default channel from bot settings
    const defaultChannel =
      await this.settingsService.getDiscordBotDefaultChannel();
    if (defaultChannel) {
      return defaultChannel;
    }

    // Priority 3: No channel configured
    this.logger.warn(
      'No Discord channel configured for event posting. ' +
        'Set a default channel in the Discord bot settings or bind a channel with /bind.',
    );
    return null;
  }

  /**
   * Resolve the voice channel for an event (for invite DM embeds).
   * Looks for game-voice-monitor bindings specifically.
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @returns Voice channel ID string or null if none configured
   */
  async resolveVoiceChannelForEvent(
    gameId?: number | null,
  ): Promise<string | null> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) return null;

    return this.channelBindingsService.getVoiceChannelForGame(guildId, gameId);
  }
}
