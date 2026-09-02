/**
 * Shared chrome helpers for Community Lineup Discord embeds (ROK-932).
 * Extracted from lineup-notification-embed.helpers.ts in ROK-1063 to keep
 * both files under the 300-line ESLint limit.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  applyEmbedChrome,
  type EmbedState,
} from '../discord-bot/embeds/embed-chrome.helpers';
import type {
  EmbedContext,
  LineupPhase,
} from './lineup-notification-embed.helpers';

/** Convert a Date to Discord relative timestamp: `<t:UNIX:R>`. */
export function discordTs(date: Date, style: 'R' | 'f' | 'F' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Build a link button pointing at the lineup page with a custom label. */
export function ctaButton(
  ctx: EmbedContext,
  label: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(`${ctx.baseUrl}/community-lineup/${ctx.lineupId}`),
  );
}

const PHASE_LABELS: [LineupPhase, string][] = [
  ['nominations', 'Nominations'],
  ['voting', 'Voting'],
  ['decided', 'Scheduling'],
];

/** Build a breadcrumb with completed phases struck through. */
function phaseBreadcrumb(current: LineupPhase): string {
  const idx = PHASE_LABELS.findIndex(([k]) => k === current);
  return PHASE_LABELS.map(([key, name], i) => {
    if (i < idx) return `\u2705 ${name}`;
    if (key === current) return `\u{1F539} **${name}**`;
    return `\u2796 ${name}`;
  }).join('  \u203A  ');
}

/**
 * Resolve the embed title: prepend the operator-authored lineup title to the
 * phase headline when present, otherwise fall back to the legacy default
 * ("Community Lineup — <headline>") (ROK-1063).
 */
export function resolveEmbedTitle(
  ctx: EmbedContext,
  emoji: string,
  headline: string,
): string {
  const base = ctx.lineupTitle?.trim() || 'Community Lineup';
  return `${emoji} ${base} — ${headline}`;
}

/**
 * Apply the lineup-only phase breadcrumb, then the shared embed chrome.
 *
 * Colour, author, footer and timestamp all come from `applyEmbedChrome`
 * (ROK-1459) — lineup builders no longer call `setColor` themselves.
 *
 * @param embed - The embed to mutate in place.
 * @param ctx - Lineup context supplying the community name and phase.
 * @param label - Footer label, rendered as `<community> \u00B7 <label>`.
 * @param state - Lifecycle state driving the colour.
 */
export function applyChrome(
  embed: EmbedBuilder,
  ctx: EmbedContext,
  label: string,
  state: EmbedState,
): void {
  embed.addFields({
    name: '\u200B',
    value: phaseBreadcrumb(ctx.phase),
    inline: false,
  });
  applyEmbedChrome(embed, {
    surface: 'channel',
    state,
    communityName: ctx.communityName,
    footerLabel: label,
  });
}
