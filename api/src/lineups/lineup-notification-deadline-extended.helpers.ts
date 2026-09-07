/**
 * Deadline-extended channel notice (ROK-1443).
 *
 * The building deadline passed with fewer nominations than voting needs, so
 * the window was extended once. This is the channel-only notice (no DMs — the
 * operator ruling asked for a channel notice + timeline entry). Lives in its
 * own file because `lineup-notification.service.ts` is at its 300-line
 * ceiling; the processor reaches it through the service's `tieDeps` getter.
 *
 * Chrome: reuses the `created` kind (`🎲 NOMINATIONS OPEN · closes …`) —
 * nominations ARE still open, with a new deadline — under a
 * `Deadline extended` footer label. Colour, author line and footer all come
 * from `createLineupEmbed`; this builder sets only the description.
 */
import { lineupLink } from './lineup-notification-author.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';
import {
  appendBreadcrumb,
  createLineupEmbed,
  discordTs,
} from './lineup-notification-embed-chrome.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
} from './lineup-notification-embed.helpers';

export interface DeadlineExtendedLineup {
  id: number;
  title?: string;
  description?: string | null;
  channelOverrideId: string | null;
}

/** Copy for the shortfall line — `0` and `1` are the only counts that reach here. */
function shortfallLine(nominationCount: number): string {
  return nominationCount === 0
    ? 'Nobody has nominated a game yet'
    : 'Only one game has been nominated so far';
}

/**
 * Build the deadline-extended embed.
 *
 * @param ctx - Lineup context; `phaseDeadline` should already be the NEW one.
 * @param newDeadline - Where the nomination deadline moved to.
 * @param nominationCount - Nominations on the board at the old deadline.
 * @returns The built embed; this family carries no action row.
 */
export function buildDeadlineExtendedEmbed(
  ctx: EmbedContext,
  newDeadline: Date,
  nominationCount: number,
): EmbedWithRow {
  const embed = createLineupEmbed(ctx, 'created', 'Deadline extended');
  embed.setDescription(
    `${shortfallLine(nominationCount)}, so the nomination deadline moved to ` +
      `${discordTs(newDeadline, 'f')} (${discordTs(newDeadline)}).\n\n` +
      'Voting opens only with two or more games on the board. If it is still ' +
      'short at the new deadline, the lineup closes without a vote.\n\n' +
      lineupLink(ctx, 'Nominate a game ↗'),
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/**
 * Post the deadline-extended channel embed. Honors the lineup channel
 * override, falling back to the bound default; silently skips if no channel
 * resolves. Dedup key is per lineup — the window is only ever extended once.
 */
export async function notifyDeadlineExtended(
  deps: DispatchDeps,
  lineup: DeadlineExtendedLineup,
  newDeadline: Date,
  nominationCount: number,
): Promise<void> {
  const ctx = await resolveEmbedCtx(deps, lineup.id, 'nominations', {
    title: lineup.title,
    description: lineup.description ?? undefined,
    phaseDeadline: newDeadline,
  });
  await postChannelEmbed(
    deps,
    `lineup-deadline-extended:${lineup.id}`,
    () => buildDeadlineExtendedEmbed(ctx, newDeadline, nominationCount),
    ctx,
    lineup.channelOverrideId,
  );
}
