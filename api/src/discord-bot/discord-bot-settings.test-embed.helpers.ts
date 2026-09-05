/**
 * ROK-1477 (Lane A) — the admin "test message" embed.
 *
 * D7: `discord-bot-settings.controller.ts` sat at 298/300 counted lines, so
 * this module is carved out BEFORE the chrome migration rather than in
 * reaction to a lint failure. The extraction itself is behaviour-neutral.
 */
import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from './discord-bot.constants';
import type { SettingsService } from '../settings/settings.service';
import type { DiscordBotClientService } from './discord-bot-client.service';

/**
 * Build the "the bot is online" embed the admin UI posts to the default
 * notification channel.
 *
 * @param name - Resolved community name.
 * @param clientUrl - Configured app URL, or null when unset.
 * @returns The test embed.
 */
export function buildTestEmbed(
  name: string,
  clientUrl: string | null,
): EmbedBuilder {
  const desc = [
    `**${name}** is now online and ready to go!`,
    '',
    '\u{1F4C5} Schedule raids, track attendance, and manage your roster — all from one place.',
  ];
  if (clientUrl) desc.push('', `\u{1F517} [Open ${name}](${clientUrl})`);
  return new EmbedBuilder()
    .setTitle(`${name} is Online`)
    .setDescription(desc.join('\n'))
    .setColor(EMBED_COLORS.SYSTEM)
    .setFooter({ text: 'Powered by Raid Ledger' })
    .setTimestamp();
}

/**
 * Build and send the test embed to the given channel.
 *
 * @param settingsService - Source of the branding + client URL.
 * @param botClient - Discord client wrapper that posts the embed.
 * @param channelId - Target text channel.
 */
export async function sendTestEmbed(
  settingsService: SettingsService,
  botClient: DiscordBotClientService,
  channelId: string,
): Promise<void> {
  const [branding, clientUrl] = await Promise.all([
    settingsService.getBranding(),
    settingsService.getClientUrl(),
  ]);
  const name = branding.communityName || 'Raid Ledger';
  await botClient.sendEmbed(channelId, buildTestEmbed(name, clientUrl));
}
