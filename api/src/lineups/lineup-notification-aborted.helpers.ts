/**
 * Aborted-lineup notification orchestrator (ROK-1062, ROK-1528).
 *
 * Extracted into its own file so `lineup-notification.service.ts` stays
 * under the 300-line ESLint ceiling. Mirrors the structure of
 * `lineup-notification-tiebreaker.helpers.ts`.
 */
import type { NotificationService } from '../notifications/notification.service';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';
import type { LineupPhase } from './lineup-notification-embed.helpers';
import { buildAbortedEmbed } from './lineup-notification-aborted-embed.helpers';
import { fanOutAbortedDMsToInvitees } from './lineup-notification-aborted-dm.helpers';
import { resolveLineupVisibility } from './lineup-notification-routing.helpers';
import type { LineupInfo } from './lineup-notification.service';

/** Dispatch deps plus the DM pipeline the private branch needs (ROK-1528). */
export type AbortDispatchDeps = DispatchDeps & {
  notificationService: NotificationService;
};

/** Resolve the breadcrumb phase from the pre-abort lineup status. */
function resolvePhase(status: LineupInfo['preAbortStatus']): LineupPhase {
  if (status === 'voting') return 'voting';
  if (status === 'decided') return 'decided';
  return 'nominations';
}

/**
 * Private-branch dispatch for the abort card (ROK-1528): DM invitees +
 * creator and skip the channel embed entirely.
 *
 * Fail-closed like every other `route…IfPrivate` helper — a missing lineup
 * row (`null` visibility) suppresses the channel post rather than risking a
 * leak for a lineup we can no longer classify.
 *
 * @returns true when the private path was taken and the caller must stop.
 */
async function routeLineupAbortedIfPrivate(
  deps: AbortDispatchDeps,
  lineup: LineupInfo,
  reason: string | null,
  actorDisplayName: string,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(deps.db, lineup);
  if (visibility === null) return true;
  if (visibility !== 'private') return false;
  await fanOutAbortedDMsToInvitees(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    reason,
    actorDisplayName,
  );
  return true;
}

/**
 * Announce an aborted lineup (ROK-1062, ROK-1528).
 *
 * Private lineups get invitee DMs only — nothing reaches the public channel.
 * Public lineups post the abort channel embed and send no DMs, honoring the
 * lineup channel override and falling back to the bound default; they
 * silently skip if no channel resolves.
 */
export async function notifyLineupAborted(
  deps: AbortDispatchDeps,
  lineup: LineupInfo,
  reason: string | null,
  actorDisplayName: string,
): Promise<void> {
  if (await routeLineupAbortedIfPrivate(deps, lineup, reason, actorDisplayName))
    return;
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
