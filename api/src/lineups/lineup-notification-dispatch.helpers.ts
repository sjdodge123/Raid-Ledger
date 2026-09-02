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

/**
 * Overrides a caller may layer onto the resolved context.
 *
 * ROK-1461: the last three feed the state-carrying author line and the
 * milestone body — callers that already hold them skip a second DB read.
 */
export interface EmbedCtxOverrides {
  title?: string;
  description?: string | null;
  phaseDeadline?: Date | null;
  nominationCount?: number;
  nominationCap?: number;
  tiebreakerRound?: number;
}

/**
 * Overrides for the lineup-CREATED embed (posted and refreshed).
 *
 * ROK-1461: the created embed is the most-seen one in the family, so its
 * author line has to carry the real nomination deadline — a lineup row is not
 * re-read on this path (the caller already holds the metadata), which is why
 * the deadline travels here rather than through `loadLineupMeta`.
 *
 */
export interface CreatedLineupMeta {
  id: number;
  title?: string;
  description?: string | null;
  phaseDeadline?: Date | null;
}

/**
 * Resolve the context for the lineup-CREATED embed in one call, so the
 * composition root does not have to spell the overrides out twice.
 *
 * @param deps - Settings + DB access.
 * @param lineup - The lineup being announced or re-rendered.
 * @returns The context the created-embed builder reads.
 */
export function resolveCreatedCtx(
  deps: DispatchDeps,
  lineup: CreatedLineupMeta,
): Promise<EmbedContext> {
  return resolveEmbedCtx(deps, lineup.id, 'nominations', {
    title: lineup.title,
    description: lineup.description ?? null,
    phaseDeadline: lineup.phaseDeadline ?? undefined,
  });
}

/**
 * Build the EmbedContext used by every channel embed.
 *
 * @param deps - Settings + DB access for the community name and lineup meta.
 * @param lineupId - The lineup being announced.
 * @param phase - Phase the breadcrumb marks as current.
 * @param overrides - Caller-supplied values that win over the stored row.
 * @returns The context every lineup builder reads.
 */
export async function resolveEmbedCtx(
  deps: DispatchDeps,
  lineupId: number,
  phase: LineupPhase,
  overrides?: EmbedCtxOverrides,
): Promise<EmbedContext> {
  const baseUrl = (await deps.settingsService.getClientUrl()) ?? '';
  const community = await deps.settingsService.get('community_name');
  const meta = overrides?.title
    ? overrides
    : await loadLineupMeta(deps.db, lineupId);
  const deadline = overrides?.phaseDeadline ?? meta.phaseDeadline ?? undefined;
  return {
    baseUrl,
    lineupId,
    communityName: community ?? 'Raid Ledger',
    phase,
    lineupTitle: meta.title,
    lineupDescription: meta.description ?? null,
    phaseDeadline: deadline ?? undefined,
    nominationCount: overrides?.nominationCount,
    nominationCap: overrides?.nominationCap,
    tiebreakerRound: overrides?.tiebreakerRound,
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
  // ROK-1461: no action row — every call to action is a masked link now.
  const sent = await deps.botClient.sendEmbed(channelId, result.embed);
  return { channelId, messageId: sent.id };
}
