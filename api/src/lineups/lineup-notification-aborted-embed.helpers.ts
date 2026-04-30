/**
 * Aborted-lineup Discord embed builder (ROK-1062).
 *
 * Extracted from `lineup-notification-embed.helpers.ts` because that file
 * is already at 350 lines — adding a new builder there would push it over
 * the 300-line ESLint limit.
 *
 * The action row carries a single "View Lineup" link button. Discord
 * rejects empty action rows, so we mirror the link-button pattern from
 * `buildEventCreatedEmbed`.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';
import {
  applyChrome,
  resolveEmbedTitle,
} from './lineup-notification-embed-chrome.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
} from './lineup-notification-embed.helpers';

/**
 * Lineup aborted by an admin/operator (ROK-1062).
 *
 * Body line 1 always names the actor. The optional `reason` is appended on
 * a fresh line only when non-empty after `.trim()`. The footer chrome label
 * is `"Aborted"` so the footer reads `<community> · Aborted`.
 */
export function buildAbortedEmbed(
  ctx: EmbedContext,
  reason: string | null | undefined,
  actorDisplayName: string,
): EmbedWithRow {
  const trimmedReason = reason?.trim() ?? '';
  const reasonBlock = trimmedReason ? `\n\n${trimmedReason}` : '';

  const embed = new EmbedBuilder()
    .setTitle(resolveEmbedTitle(ctx, '\u{1F6D1}', 'Aborted'))
    .setDescription(
      `This lineup was aborted by **${actorDisplayName}**.` + reasonBlock,
    )
    .setColor(EMBED_COLORS.ERROR);

  applyChrome(embed, ctx, 'Aborted');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL(`${ctx.baseUrl}/community-lineup/${ctx.lineupId}`),
  );
  return { embed, row };
}
