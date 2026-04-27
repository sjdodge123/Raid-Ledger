/**
 * Tiebreaker-open notification orchestrator (ROK-1117).
 *
 * Mirrors `notifyVotingOpen` but for the bracket / veto tiebreaker
 * round: DMs every expected voter (public = nominators ∪ voters,
 * private = creator + invitees, via `loadExpectedVoters`) and posts
 * a channel embed for public lineups only. Private lineups suppress
 * the channel embed (ROK-1065 routing).
 *
 * Extracted into its own file so `lineup-notification.service.ts`
 * stays under the 300-line ESLint ceiling.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { SettingsService } from '../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { buildTiebreakerStartedEmbed } from './lineup-notification-embed.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';
import { fanOutTiebreakerOpenDMs } from './lineup-notification-dm-batch.helpers';
import { resolveLineupVisibility } from './lineup-notification-routing.helpers';
import type { LineupInfo } from './lineup-notification.service';
import type { TiebreakerNotificationInfo } from './lineup-notification-private-dm.helpers';

export type { TiebreakerNotificationInfo } from './lineup-notification-private-dm.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Composed deps for the tiebreaker-open orchestrator. */
export interface TiebreakerOpenDeps {
  db: Db;
  notificationService: NotificationService;
  dedupService: NotificationDedupService;
  botClient: DiscordBotClientService;
  settingsService: SettingsService;
}

function dispatchDeps(deps: TiebreakerOpenDeps): DispatchDeps {
  const { db, settingsService, botClient, dedupService } = deps;
  return { db, settingsService, botClient, dedupService };
}

/**
 * Orchestrate the tiebreaker-open dispatch:
 *   1. Fan-out DMs to every expected voter (visibility-aware via
 *      `loadExpectedVoters`).
 *   2. Post the channel embed for public lineups only (private lineups
 *      suppress the embed; DMs already covered the invitees).
 */
export async function notifyTiebreakerOpen(
  deps: TiebreakerOpenDeps,
  lineup: LineupInfo,
  tiebreaker: TiebreakerNotificationInfo,
): Promise<void> {
  await fanOutTiebreakerOpenDMs(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    tiebreaker,
  );

  const visibility = await resolveLineupVisibility(deps.db, lineup);
  if (visibility !== 'public') return;

  const ctx = await resolveEmbedCtx(dispatchDeps(deps), lineup.id, 'voting');
  await postChannelEmbed(
    dispatchDeps(deps),
    `lineup-tiebreaker-open:${tiebreaker.id}`,
    () =>
      buildTiebreakerStartedEmbed(
        ctx,
        tiebreaker.mode,
        tiebreaker.roundDeadline ?? undefined,
      ),
    ctx,
  );
}
