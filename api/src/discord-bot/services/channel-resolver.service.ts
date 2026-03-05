import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';

/**
 * Resolves which Discord channel to post event embeds to.
 *
 * Channel resolution priority (ROK-599 update):
 * 0. Per-event notification channel override (ROK-599)
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
   * @param notificationChannelOverride - Optional per-event channel override (ROK-599)
   * @returns Channel ID string or null if no channel configured
   */
  async resolveChannelForEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
    notificationChannelOverride?: string | null,
  ): Promise<string | null> {
    // Priority 0: Per-event notification channel override (ROK-599)
    if (notificationChannelOverride) {
      return notificationChannelOverride;
    }

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
   * 3-tier fallback: series binding → game binding → app setting default (ROK-693).
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @param recurrenceGroupId - Optional recurrence group ID for series-specific binding
   * @returns Voice channel ID string or null if none configured
   */
  async resolveVoiceChannelForEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null> {
    return this.resolveVoiceChannelForScheduledEvent(gameId, recurrenceGroupId);
  }

  /**
   * Resolve voice channel for Discord Scheduled Events (ROK-471, ROK-592, ROK-599).
   * 3-tier fallback: series-specific binding -> game-specific binding -> app setting default.
   * Note: Per-event overrides (notificationChannelOverride) are handled by callers
   * before invoking this method.
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @param recurrenceGroupId - Optional recurrence group ID for series-specific binding
   * @returns Voice channel ID string or null if none configured
   */
  async resolveVoiceChannelForScheduledEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null> {
    const guildId = this.clientService.getGuildId();

    // Tier 1: Series-specific voice binding (ROK-599)
    if (recurrenceGroupId && guildId) {
      const seriesVoice =
        await this.channelBindingsService.getVoiceChannelForSeries(
          guildId,
          recurrenceGroupId,
        );
      if (seriesVoice) return seriesVoice;
    }

    // Tier 2: Game-specific voice binding
    if (guildId) {
      const voiceChannel =
        await this.channelBindingsService.getVoiceChannelForGame(
          guildId,
          gameId,
        );
      if (voiceChannel) return voiceChannel;
    }

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
