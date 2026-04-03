/**
 * Resolves the Discord channel for lineup embeds (ROK-932).
 * Falls back from dedicated lineup channel to announcement channel.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';

/**
 * Resolve the channel ID for posting lineup embeds.
 * Priority: admin-configured lineup channel -> default announcement channel -> null.
 *
 * @param settingsService - The application settings service
 * @returns The resolved channel ID, or null if none configured
 */
export async function resolveLineupChannel(
  settingsService: SettingsService,
): Promise<string | null> {
  const lineupChannel = await settingsService.get(
    SETTING_KEYS.DISCORD_BOT_LINEUP_CHANNEL,
  );
  if (lineupChannel) return lineupChannel;

  return settingsService.getDiscordBotDefaultChannel();
}
