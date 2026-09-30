/**
 * Structural match for a lineup's nomination-milestone channel card.
 *
 * The API builds it with `createLineupEmbed(ctx, 'milestone',
 * 'Nomination Milestone')` (api/src/lineups/lineup-notification-embed.helpers.ts),
 * so the shared chrome sets the footer to `<community> · Nomination Milestone`
 * and the title to the lineup title.
 *
 * The old matcher ran /milestone|nominations filled|nominated/i over
 * title + author + description and then checked the title appeared anywhere.
 * With a fixture title containing "Milestone", the regex matched the title
 * itself, so ANY card for that lineup matched — including the 🛑 ABORTED
 * card another test's global archive posts (TDB:1071).
 */
import type { SimpleEmbed } from '../helpers/messages.js';

export const MILESTONE_FOOTER_LABEL = 'Nomination Milestone';

/** True only for the nomination-milestone card of the lineup titled `title`. */
export function isMilestoneCardFor(
  embed: Pick<SimpleEmbed, 'title' | 'footer'>,
  title: string,
): boolean {
  const footer = (embed.footer ?? '').trimEnd();
  return (
    footer.endsWith(MILESTONE_FOOTER_LABEL) && (embed.title ?? '').includes(title)
  );
}
