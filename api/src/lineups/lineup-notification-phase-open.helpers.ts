/**
 * Phase-open orchestrators for LineupNotificationService: lineup created
 * (AC-1), the created-embed refresh (ROK-1063) and voting open (AC-3).
 * Extracted from the service to keep it under the 300-line ESLint ceiling.
 *
 * The dispatch helpers get the narrowed `dispatchDeps(deps)`, as in the
 * public-dispatch orchestrators.
 */
import type { Logger } from '@nestjs/common';
import {
  persistCreatedEmbedRef,
  loadCreatedEmbedRef,
  editCreatedEmbedSafe,
} from './lineup-notification-refresh.helpers';
import {
  buildCreatedEmbed,
  buildVotingOpenEmbed,
} from './lineup-notification-embed.helpers';
import { fanOutVotingDMs } from './lineup-notification-dm-batch.helpers';
import {
  routeLineupCreatedIfPrivate,
  routeVotingOpenIfPrivate,
} from './lineup-notification-routing.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  resolveCreatedCtx,
} from './lineup-notification-dispatch.helpers';
import {
  dispatchDeps,
  type OrchestrationDeps,
} from './lineup-notification-public-dispatch.helpers';
import type { LineupInfo } from './lineup-notification.service';

/** AC-1: Post channel embed when lineup is created. */
export async function orchestrateLineupCreated(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
): Promise<void> {
  const routedPrivate = await routeLineupCreatedIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
  );
  if (routedPrivate) return;
  const ctx = await resolveCreatedCtx(dispatchDeps(deps), lineup);
  const sent = await postChannelEmbed(
    dispatchDeps(deps),
    `lineup-created:${lineup.id}`,
    () => buildCreatedEmbed(ctx, lineup.targetDate),
    ctx,
    lineup.channelOverrideId,
  );
  if (sent) {
    await persistCreatedEmbedRef(
      deps.db,
      lineup.id,
      sent.channelId,
      sent.messageId,
    );
  }
}

/**
 * Refresh the lineup-created embed after metadata edit (ROK-1063).
 * Edits the original Discord message in place with the new title/description.
 * Silent no-op if no stored message ref (e.g. channel not configured at creation).
 */
export async function refreshCreatedEmbedFor(
  deps: OrchestrationDeps,
  logger: Logger,
  lineup: LineupInfo,
): Promise<void> {
  const ref = await loadCreatedEmbedRef(deps.db, lineup.id);
  if (!ref) return;
  const ctx = await resolveCreatedCtx(dispatchDeps(deps), lineup);
  const built = buildCreatedEmbed(ctx, ref.targetDate ?? undefined);
  await editCreatedEmbedSafe(
    deps.botClient,
    logger,
    lineup.id,
    ref,
    built.embed,
  );
}

/** AC-3 channel half: resolve the voting context and post its embed. */
async function postVotingOpenEmbed(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
  games: { id: number; name: string }[],
): Promise<void> {
  const ctx = await resolveEmbedCtx(dispatchDeps(deps), lineup.id, 'voting');
  await postChannelEmbed(
    dispatchDeps(deps),
    `lineup-voting:${lineup.id}`,
    () => buildVotingOpenEmbed(ctx, games, lineup.votingDeadline),
    ctx,
  );
}

/** AC-3: Post channel embed + DMs when voting opens. */
export async function orchestrateVotingOpen(
  deps: OrchestrationDeps,
  lineup: LineupInfo,
  games: { id: number; name: string }[],
): Promise<void> {
  const clientUrl = await deps.settingsService.getClientUrl();
  const routedPrivate = await routeVotingOpenIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    games,
    clientUrl,
  );
  if (routedPrivate) return;
  await postVotingOpenEmbed(deps, lineup, games);
  await fanOutVotingDMs(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    games,
    clientUrl,
  );
}
