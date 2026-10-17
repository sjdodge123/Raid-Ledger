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
    if (notificationChannelOverride) return notificationChannelOverride;
    const guildId = this.clientService.getGuildId();
    const bound = await this.resolveBindingChannel(
      guildId,
      gameId,
      recurrenceGroupId,
    );
    if (bound) return bound;
    const defaultChannel =
      await this.settingsService.getDiscordBotDefaultChannel();
    if (defaultChannel) return defaultChannel;
    this.logger.warn(
      'No Discord channel configured for event posting. ' +
        'Set a default channel in the Discord bot settings or bind a channel with /bind.',
    );
    return null;
  }

  /** Resolve channel from series or game bindings. */
  private async resolveBindingChannel(
    guildId: string | null,
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null> {
    if (recurrenceGroupId && guildId) {
      const ch = await this.channelBindingsService.getChannelForSeries(
        guildId,
        recurrenceGroupId,
      );
      if (ch) return ch;
    }
    if (gameId && guildId) {
      const ch = await this.channelBindingsService.getChannelForGame(
        guildId,
        gameId,
      );
      if (ch) return ch;
    }
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
    ephemeralChannelId?: string | null,
  ): Promise<string | null> {
    return this.resolveVoiceChannelForScheduledEvent(
      gameId,
      recurrenceGroupId,
      ephemeralChannelId,
    );
  }

  /**
   * Resolve voice channel for Discord Scheduled Events (ROK-471, ROK-592, ROK-599).
   * Tier 0 (ROK-1352): a live ephemeral channel; then 3-tier fallback:
   * series-specific binding -> game-specific binding -> app setting default.
   * Note: Per-event overrides (notificationChannelOverride) are handled by callers
   * before invoking this method.
   * @param gameId - Games table PK (integer) for game-specific binding lookup
   * @param recurrenceGroupId - Optional recurrence group ID for series-specific binding
   * @param ephemeralChannelId - ROK-1352 Tier 0: live ephemeral channel (wins if set)
   * @returns Voice channel ID string or null if none configured
   */
  async resolveVoiceChannelForScheduledEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
    ephemeralChannelId?: string | null,
  ): Promise<string | null> {
    // Tier 0 (ROK-1352): a live ephemeral channel overrides all static bindings.
    if (ephemeralChannelId) return ephemeralChannelId;

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

  /**
   * Resolve the voice channel while honoring a per-event override ONLY when it
   * points at a voice channel (ROK-1389). This is the single voice-resolution
   * entry every row-level surface (website detail, reminder deep-links, embed
   * voice field, SE create/edit) routes through, so they can never disagree.
   *
   * A cached TEXT override falls through to the tiered resolution (mirrors the
   * guard that previously lived only in resolveVoiceForEdit); an override the
   * guild cache doesn't know is used optimistically (may be an uncached voice
   * channel). The override was returned unconditionally before, which routed
   * reminders/attendance to a non-voice channel.
   */
  async resolveVoiceChannelHonoringOverride(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
    ephemeralChannelId?: string | null,
    override?: string | null,
  ): Promise<string | null> {
    if (override && this.overrideIsVoiceChannel(override)) return override;
    return this.resolveVoiceChannelForScheduledEvent(
      gameId,
      recurrenceGroupId,
      ephemeralChannelId,
    );
  }

  /**
   * True when the override is a voice channel, or when the guild cache doesn't
   * know it (optimistic — may be an uncached voice channel). Mirrors
   * resolveVoiceForEdit's guard so voice-ness lives in one place.
   */
  private overrideIsVoiceChannel(override: string): boolean {
    const guild = this.clientService.getGuild();
    const cached = guild?.channels.cache.get(override);
    return !cached || cached.isVoiceBased();
  }
}
