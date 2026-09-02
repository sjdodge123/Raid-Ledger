/**
 * Invite embed helpers for DiscordEmbedFactory.
 * Extracted from discord-embed.factory.ts for file size compliance (ROK-719).
 */
import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import { createDmEmbed, type DmEmbed } from '../embeds/embed-chrome.helpers';
import { openEventLink } from './discord-embed-event-chrome.helpers';
import type { EmbedEventData, EmbedContext } from './discord-embed.factory';

/** `✉ INVITED BY roknua` — the DM's author line (ROK-1460 §Grammar). */
const ENVELOPE = '✉';

/**
 * Build an invite embed for DM notifications (ROK-380).
 *
 * The DM surface, so `createDmEmbed`: the inviter goes on the author line and
 * the footer carries the community name only. Personalized (reader-specific)
 * fields belong here rather than on any channel embed — slice D adds them.
 *
 * @param event - The event the reader is invited to.
 * @param context - Community name and client URL.
 * @param inviterUsername - Who sent the invite.
 * @returns A DM-branded embed.
 */
export function createInviteEmbed(
  event: EmbedEventData,
  context: EmbedContext,
  inviterUsername: string,
): DmEmbed {
  const clientUrl = context.clientUrl || process.env.CLIENT_URL;
  const bodyLines = buildInviteBodyLines(event);
  const signUp = openEventLink(clientUrl, event.id, 'Sign up ↗');
  if (signUp) bodyLines.push('', signUp);

  const embed = createDmEmbed({
    state: 'needs_you',
    communityName: context.communityName,
    authorLine: `${ENVELOPE} INVITED BY ${inviterUsername}`,
  });
  embed
    .setTitle(`You're invited to **${event.title}**!`)
    .setDescription(bodyLines.join('\n'));

  if (clientUrl) embed.setURL(`${clientUrl}/events/${event.id}`);
  const thumbnail = absoluteEmbedImageUrl(event.game?.coverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);

  // slice D: personalized (owned / wishlist / hearted) fields attach here.
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
