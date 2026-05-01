/**
 * Aborted-lineup channel-embed orchestrator (ROK-1062).
 *
 * Extracted into its own file so `lineup-notification.service.ts` stays
 * under the 300-line ESLint ceiling. Mirrors the structure of
 * `lineup-notification-tiebreaker.helpers.ts`.
 */
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';
import type { LineupPhase } from './lineup-notification-embed.helpers';
import { buildAbortedEmbed } from './lineup-notification-aborted-embed.helpers';
import type { LineupInfo } from './lineup-notification.service';

/** Resolve the breadcrumb phase from the pre-abort lineup status. */
function resolvePhase(status: LineupInfo['preAbortStatus']): LineupPhase {
  if (status === 'voting') return 'voting';
  if (status === 'decided') return 'decided';
  return 'nominations';
}

/**
 * Post the abort channel embed. No DMs. Honors lineup channel override,
 * falling back to the bound default; silently skips if no channel resolves.
 */
export async function notifyLineupAborted(
  deps: DispatchDeps,
  lineup: LineupInfo,
  reason: string | null,
  actorDisplayName: string,
): Promise<void> {
  const phase = resolvePhase(lineup.preAbortStatus);
  const ctx = await resolveEmbedCtx(deps, lineup.id, phase, {
    title: lineup.title,
    description: lineup.description ?? null,
  });
  await postChannelEmbed(
    deps,
    `lineup-aborted:${lineup.id}`,
    () => buildAbortedEmbed(ctx, reason, actorDisplayName),
    ctx,
    lineup.channelOverrideId,
  );
}
