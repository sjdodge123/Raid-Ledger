/**
 * Helpers for building scheduling poll Discord embeds (ROK-1014).
 * Extracted to keep the factory file within the 300-line limit.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { EmbedContext } from './discord-embed.factory';
import type { SchedulingPollEmbedData } from './discord-embed-scheduling.types';

const MAX_DISPLAY_SLOTS = 3;

/** Format a slot time as a Discord timestamp. */
function formatSlotTimestamp(iso: string): string {
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${unix}:f>`;
}

/** Build slot lines for the embed description. */
function buildSlotLines(slots: SchedulingPollEmbedData['slots']): string[] {
  const sorted = [...slots].sort((a, b) => b.voteCount - a.voteCount);
  const top = sorted.slice(0, MAX_DISPLAY_SLOTS);
  return top.map(
    (s) =>
      `${formatSlotTimestamp(s.proposedTime)} — **${s.voteCount}** vote${s.voteCount === 1 ? '' : 's'}`,
  );
}

/** Build the embed body for a scheduling poll. */
export function buildSchedulingPollEmbedBody(
  data: SchedulingPollEmbedData,
  context: EmbedContext,
): EmbedBuilder {
  const community = context.communityName || 'Raid Ledger';
  const embed = new EmbedBuilder()
    .setAuthor({ name: community })
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTitle(`Scheduling Poll — ${data.gameName}`)
    .setFooter({
      text: `${data.uniqueVoterCount} voter${data.uniqueVoterCount === 1 ? '' : 's'} participated`,
    })
    .setTimestamp();

  const lines: string[] = ['Vote for the best time to play!', ''];
  if (data.slots.length === 0) {
    lines.push('*No times suggested yet.*');
  } else {
    lines.push(...buildSlotLines(data.slots));
  }
  embed.setDescription(lines.join('\n'));

  if (data.gameCoverUrl) {
    embed.setThumbnail(data.gameCoverUrl);
  }

  return embed;
}

/** Build the "Vote Now" link button row. */
export function buildSchedulingPollButton(
  data: SchedulingPollEmbedData,
): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setLabel('Vote Now')
    .setStyle(ButtonStyle.Link)
    .setURL(data.pollUrl);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}
