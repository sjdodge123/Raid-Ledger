/**
 * Invite embed helpers for DiscordEmbedFactory.
 * Extracted from discord-embed.factory.ts for file size compliance (ROK-719).
 */
import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { EmbedEventData, EmbedContext } from './discord-embed.factory';

/** Build an invite embed for DM notifications (ROK-380). */
export function createInviteEmbed(
  event: EmbedEventData,
  context: EmbedContext,
  inviterUsername: string,
): EmbedBuilder {
  const bodyLines = buildInviteBodyLines(event);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.PUG_INVITE)
    .setTitle(`You're invited to **${event.title}**!`)
    .setDescription(bodyLines.join('\n'))
    .setFooter({
      text: `Sent by ${inviterUsername} via ${context.communityName || 'Raid Ledger'}`,
    })
    .setTimestamp();

  const clientUrl = context.clientUrl || process.env.CLIENT_URL;
  if (clientUrl) embed.setURL(`${clientUrl}/events/${event.id}`);
  if (event.game?.coverUrl) embed.setThumbnail(event.game.coverUrl);

  return embed;
}

/** Build body lines for an invite embed. */
function buildInviteBodyLines(event: EmbedEventData): string[] {
  const startUnix = Math.floor(new Date(event.startTime).getTime() / 1000);
  const lines: string[] = [];
  if (event.game?.name) lines.push(`\uD83C\uDFAE **${event.game.name}**`);
  lines.push(`\uD83D\uDCC6 <t:${startUnix}:f> (<t:${startUnix}:R>)`);
  if (event.voiceChannelId)
    lines.push(`\uD83D\uDD0A <#${event.voiceChannelId}>`);
  if (event.description) {
    const excerpt =
      event.description.length > 200
        ? event.description.slice(0, 200) + '...'
        : event.description;
    lines.push('', excerpt);
  }
  return lines;
}
