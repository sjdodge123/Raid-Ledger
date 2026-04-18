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

/** Apply shared author + phase breadcrumb + footer to an embed. */
export function applyChrome(
  embed: EmbedBuilder,
  ctx: EmbedContext,
  label: string,
): void {
  embed
    .setAuthor({ name: ctx.communityName || 'Raid Ledger' })
    .addFields({
      name: '\u200B',
      value: phaseBreadcrumb(ctx.phase),
      inline: false,
    })
    .setFooter({
      text: `${ctx.communityName || 'Raid Ledger'} \u00B7 ${label}`,
    })
    .setTimestamp();
}
