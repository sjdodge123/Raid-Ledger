/**
 * Shared chrome helpers for Community Lineup Discord embeds (ROK-932).
 * Extracted from lineup-notification-embed.helpers.ts in ROK-1063 to keep
 * both files under the 300-line ESLint limit.
 *
 * ROK-1461 (slice C): the family is created through `createChannelEmbed`, so
 * the personalized-field guard bites at WRITE time, and the state-carrying
 * author line comes from `lineup-notification-author.helpers.ts`. The
 * `ctaButton` row is gone — every call to action is a masked link now.
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../discord-bot/embeds/embed-chrome.helpers';
import {
  lineupAuthorLineFor,
  lineupChromeState,
  type LineupEmbedKind,
} from './lineup-notification-author.helpers';
import type {
  EmbedContext,
  LineupPhase,
} from './lineup-notification-embed.helpers';

/** Convert a Date to Discord relative timestamp: `<t:UNIX:R>`. */
export function discordTs(date: Date, style: 'R' | 'f' | 'F' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
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
 * Resolve the embed title: the operator-authored lineup title alone.
 *
 * ROK-1461 moved the emoji and the phase headline onto the author line, so
 * the title is now the bare lineup name (falling back to the legacy
 * "Community Lineup" when the operator left it blank).
 *
 * @param ctx - Lineup context carrying the operator-authored title.
 * @returns The title to render.
 */
export function resolveEmbedTitle(ctx: EmbedContext): string {
  return ctx.lineupTitle?.trim() || 'Community Lineup';
}

/**
 * Create a lineup channel embed with its chrome and bare title already set.
 *
 * Colour, author line, footer and timestamp all come from the shared chrome
 * (ROK-1459/1461) — lineup builders no longer call `setColor`, `setAuthor` or
 * `setFooter` themselves.
 *
 * @param ctx - Lineup context supplying community, title and deadlines.
 * @param kind - Which of the nine lineup notifications is being built.
 * @param label - Footer label, rendered as `<community> · <label>`.
 * @returns A `ChannelEmbed` that refuses a DM-only field at write time.
 */
export function createLineupEmbed(
  ctx: EmbedContext,
  kind: LineupEmbedKind,
  label: string,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state: lineupChromeState(kind),
    communityName: ctx.communityName,
    authorLine: lineupAuthorLineFor(kind, ctx),
    footerLabel: label,
  });
  embed.setTitle(resolveEmbedTitle(ctx));
  return embed;
}

/**
 * Append the lineup-only phase breadcrumb as the embed's last field.
 *
 * @param embed - The embed to mutate in place.
 * @param ctx - Lineup context supplying the current phase.
 */
export function appendBreadcrumb(embed: ChannelEmbed, ctx: EmbedContext): void {
  embed.addFields({
    name: '\u200B',
    value: phaseBreadcrumb(ctx.phase),
    inline: false,
  });
}
