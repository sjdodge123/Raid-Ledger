import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';

/**
 * Resolves which Discord channel to post event embeds to.
 *
 * Channel resolution priority (ROK-435 update):
 * 1. Series-specific channel binding (recurrence group)
 * 2. Game-specific channel binding (ROK-348)
 * 3. Default text channel from bot settings (ROK-349)
 * 4. null — skip posting with logged warning
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
   * @param recurrenceGroupId - Optional recurrence group ID for series-specific binding (ROK-435)
   * @returns Channel ID string or null if no channel configured
   */
  async resolveChannelForEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null> {
    const guildId = this.clientService.getGuildId();

    // Priority 1: Series-specific binding (ROK-435)
    if (recurrenceGroupId && guildId) {
      const seriesChannel =
        await this.channelBindingsService.getChannelForSeries(
          guildId,
          recurrenceGroupId,
        );
      if (seriesChannel) {
        return seriesChannel;
      }
    }

    // Priority 2: Game-specific binding
    if (gameId && guildId) {
      const boundChannel = await this.channelBindingsService.getChannelForGame(
        guildId,
        gameId,
      );
      if (boundChannel) {
        return boundChannel;
      }
    }

    // Priority 3: Default channel from bot settings
    const defaultChannel =
      await this.settingsService.getDiscordBotDefaultChannel();
    if (defaultChannel) {
      return defaultChannel;
    }

    // Priority 4: No channel configured
    this.logger.warn(
      'No Discord channel configured for event posting. ' +
        'Set a default channel in the Discord bot settings or bind a channel with /bind.',
    );
    return null;
  }

  /**
   * Resolve the voice channel for an event (for invite DM embeds).
   * Looks for game-specific voice-monitor bindings only (ROK-592).
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

  /**
   * Resolve voice channel for Discord Scheduled Events (ROK-471, ROK-592).
   * 2-tier fallback: game-specific binding -> app setting default.
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @returns Voice channel ID string or null if none configured
   */
  async resolveVoiceChannelForScheduledEvent(
    gameId?: number | null,
  ): Promise<string | null> {
    // Tier 1: Game-specific voice binding
    const voiceChannel = await this.resolveVoiceChannelForEvent(gameId);
    if (voiceChannel) return voiceChannel;

    // Tier 3: App setting fallback
    const defaultVoice =
      await this.settingsService.getDiscordBotDefaultVoiceChannel();
    if (defaultVoice) return defaultVoice;

    this.logger.warn(
      'No voice channel configured for Discord Scheduled Event. ' +
        'Set a default voice channel in the Discord bot settings or bind a voice channel with /bind.',
    );
    return null;
  }
}
