/**
 * Aborted-lineup Discord embed builder (ROK-1062).
 *
 * Extracted from `lineup-notification-embed.helpers.ts` because that file
 * is already near the 300-line ESLint limit.
 *
 * ROK-1461: the "View Lineup" BUTTON became an `Open lineup ↗` masked link on
 * the last description line, and the chrome (cancelled colour, `🛑 ABORTED`
 * author line, `<community> · Aborted` footer) comes from the shared helper.
 */
import { lineupLink } from './lineup-notification-author.helpers';
import {
  appendBreadcrumb,
  createLineupEmbed,
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
 *
 * @param ctx - Lineup context supplying community, title and web origin.
 * @param reason - Operator-supplied reason; omitted when blank.
 * @param actorDisplayName - Who aborted the lineup.
 * @returns The built embed; this family carries no action row.
 */
export function buildAbortedEmbed(
  ctx: EmbedContext,
  reason: string | null | undefined,
  actorDisplayName: string,
): EmbedWithRow {
  const trimmedReason = reason?.trim() ?? '';
  const reasonBlock = trimmedReason ? `\n\n${trimmedReason}` : '';

  const embed = createLineupEmbed(ctx, 'aborted', 'Aborted');
  embed.setDescription(
    `This lineup was aborted by **${actorDisplayName}**.` +
      reasonBlock +
      `\n\n${lineupLink(ctx, 'Open lineup \u2197')}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}
