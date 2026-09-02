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
import { countLineupEntries } from './lineups-query.helpers';
import { loadEffectiveNominationCapById } from './lineups-nomination-cap.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface DispatchDeps {
  db: Db;
  settingsService: SettingsService;
  botClient: DiscordBotClientService;
  dedupService: NotificationDedupService;
}

/**
 * Drop empty keys so a spread cannot erase a value loaded from the row.
 *
 * `null` counts as empty, not as an explicit override: callers routinely
 * normalise a missing field to `null` (`lineup.description ?? null`), and the
 * ROK-1461 id-only refresh path did exactly that — a lineup WITH a description
 * lost it from the channel card on the first nomination. The row is the source
 * of truth for every field a caller did not deliberately supply; a caller that
 * really wants to blank a field writes the row, not the override.
 *
 * @param overrides - Caller-supplied overrides, possibly with empty holes.
 * @returns The same object without its null/undefined-valued keys.
 */
function definedOnly(
  overrides: EmbedCtxOverrides | undefined,
): Partial<EmbedCtxOverrides> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value != null),
  );
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
export async function resolveCreatedCtx(
  deps: DispatchDeps,
  lineup: CreatedLineupMeta,
): Promise<EmbedContext> {
  // ROK-1461: the live counts travel on EVERY created-card render (post and
  // in-place refresh), so the `N of M nominations filled.` line is present
  // from creation and correct after each add/remove.
  const [entryRows, nominationCap] = await Promise.all([
    countLineupEntries(deps.db, lineup.id),
    loadEffectiveNominationCapById(deps.db, lineup.id),
  ]);
  return resolveEmbedCtx(deps, lineup.id, 'nominations', {
    title: lineup.title,
    // Never synthesise `null` here: an id-only refresh means "load it", and
    // `definedOnly` must not mistake the placeholder for a real override.
    description: lineup.description ?? undefined,
    phaseDeadline: lineup.phaseDeadline ?? undefined,
    nominationCount: entryRows?.[0]?.count ?? 0,
    nominationCap,
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
  // ROK-1461 review follow-up: MERGE, never choose. The old
  // `overrides?.title ? overrides : loadLineupMeta(...)` short-circuit meant
  // any caller overriding the title silently opted out of EVERY DB-sourced
  // field — which is how the real creation hook (title + description only)
  // dropped `· closes …` in prod, and how the next field added here would
  // have too. The row is the base; supplied overrides win on top of it.
  const meta = await loadLineupMeta(deps.db, lineupId);
  const merged = { ...meta, ...definedOnly(overrides) };
  return {
    baseUrl,
    lineupId,
    communityName: community ?? 'Raid Ledger',
    phase,
    lineupTitle: merged.title,
    lineupDescription: merged.description ?? null,
    phaseDeadline: merged.phaseDeadline ?? undefined,
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
