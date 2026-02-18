import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';

/**
 * Resolves which Discord channel to post event embeds to.
 *
 * Channel resolution priority (design spec section 4.3):
 * 1. Game-specific channel binding (ROK-348 — not yet implemented)
 * 2. Default text channel from bot settings
 * 3. null — skip posting with logged warning
 */
@Injectable()
export class ChannelResolverService {
  private readonly logger = new Logger(ChannelResolverService.name);

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Resolve the target Discord channel for an event.
   * @param registryGameId - Game registry UUID (for future game-specific binding via ROK-348)
   * @returns Channel ID string or null if no channel configured
   */
  async resolveChannelForEvent(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registryGameId?: string | null,
  ): Promise<string | null> {
    // Priority 1: Game-specific binding (ROK-348 — future)
    // When ROK-348 is implemented, use registryGameId to look up game->channel bindings.

    // Priority 2: Default channel from bot settings
    const defaultChannel =
      await this.settingsService.getDiscordBotDefaultChannel();
    if (defaultChannel) {
      return defaultChannel;
    }

    // Priority 3: No channel configured
    this.logger.warn(
      'No Discord channel configured for event posting. ' +
        'Set a default channel in the Discord bot settings.',
    );
    return null;
  }
}
