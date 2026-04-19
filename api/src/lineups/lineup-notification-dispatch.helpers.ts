/**
 * Dispatch helpers for LineupNotificationService (ROK-1064 extraction).
 *
 * Extracted to keep `lineup-notification.service.ts` under the 300-line
 * limit. Nothing here talks to Discord directly — all side effects flow
 * through the injected services, so the service remains the composition
 * root for notification behavior.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { SettingsService } from '../settings/settings.service';
import {
  resolveLineupChannel,
  loadLineupMeta,
  loadLineupChannelOverride,
} from './lineup-notification-channel.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
  LineupPhase,
} from './lineup-notification-embed.helpers';
import { DEDUP_TTL } from './lineup-notification.constants';

type Db = PostgresJsDatabase<typeof schema>;

export interface DispatchDeps {
  db: Db;
  settingsService: SettingsService;
  botClient: DiscordBotClientService;
  dedupService: NotificationDedupService;
}

/** Build the EmbedContext used by every channel embed. */
export async function resolveEmbedCtx(
  deps: DispatchDeps,
  lineupId: number,
  phase: LineupPhase,
  overrides?: { title?: string; description?: string | null },
): Promise<EmbedContext> {
  const baseUrl = (await deps.settingsService.getClientUrl()) ?? '';
  const community = await deps.settingsService.get('community_name');
  const meta = overrides?.title
    ? overrides
    : await loadLineupMeta(deps.db, lineupId);
  return {
    baseUrl,
    lineupId,
    communityName: community ?? 'Raid Ledger',
    phase,
    lineupTitle: meta.title,
    lineupDescription: meta.description ?? null,
  };
}

/**
 * Dedup + resolve channel + post an embed (ROK-1063 refactor, ROK-1064).
 *
 * Honors per-lineup channel override when `overrideId` is provided directly
 * (e.g. from the creation DTO). For lifecycle hooks that only carry a
 * `lineupId`, pass `overrideId = undefined` and we'll load it from the DB.
 */
export async function postChannelEmbed(
  deps: DispatchDeps,
  dedupKey: string,
  build: (
    ctx: EmbedContext,
  ) => Promise<EmbedWithRow | null> | EmbedWithRow | null,
  ctx: EmbedContext,
  overrideId?: string | null,
): Promise<{ channelId: string; messageId: string } | null> {
  if (await deps.dedupService.checkAndMarkSent(dedupKey, DEDUP_TTL))
    return null;
  const resolvedOverride =
    overrideId === undefined
      ? await loadLineupChannelOverride(deps.db, ctx.lineupId)
      : overrideId;
  const channelId = await resolveLineupChannel(
    deps.settingsService,
    deps.botClient,
    deps.dedupService,
    ctx.lineupId,
    resolvedOverride,
  );
  if (!channelId) return null;
  const result = await build(ctx);
  if (!result) return null;
  const sent = await deps.botClient.sendEmbed(
    channelId,
    result.embed,
    result.row,
  );
  return { channelId, messageId: sent.id };
}
