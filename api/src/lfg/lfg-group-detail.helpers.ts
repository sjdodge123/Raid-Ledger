/**
 * `GET /lfg/:gameId` — the group detail read, extracted from `LfgService` so
 * the service stays under its line budget (ROK-1619 AC7 added a field).
 */
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import {
  groupReadPressWouldSpawnNow,
  resolveNowIndicatorEmoji,
} from '../discord-bot/lfg-now/lfg-now-indicator.helpers';
import { readConvertedEvent } from './lfg-converted-event.helpers';
import {
  findOpenForumThreadId,
  getGroupSummary,
  listGroupMembers,
  type LfgDb,
} from './lfg-query.helpers';
import { toIntentDto } from './lfg-write.helpers';
import {
  findOwnLiveHand,
  listOwnOtherGroups,
  resolveDetailGroup,
  type LfgDetailGroup,
} from './lfg-group-scope.helpers';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import { attachMemberDetails } from './lfg-member-details.helpers';

/** `?group` → the scope + label, folding when the game has no active adapter. */
function resolveGroupFor(
  game: typeof schema.games.$inferSelect,
  grouping?: { registry: LfgGroupingRegistry; groupKey: string | undefined },
): Promise<LfgDetailGroup> {
  if (!grouping) return Promise.resolve({ scope: null, label: null });
  const adapter = resolveLfgGrouping(grouping.registry, game.slug);
  const ctx = { gameId: game.id, gameSlug: game.slug };
  return resolveDetailGroup(adapter, ctx, grouping.groupKey);
}

/** The game's active grouping adapter, or null (no registry / plugin off). */
function adapterFor(
  game: typeof schema.games.$inferSelect,
  grouping?: { registry: LfgGroupingRegistry },
) {
  return grouping ? resolveLfgGrouping(grouping.registry, game.slug) : null;
}

/**
 * Summary, roster, the caller's own live row, the forum thread, the converted
 * event — and whether the caller's `Right now` hand would form the group.
 *
 * @param db - Drizzle handle.
 * @param game - The already-loaded game row.
 * @param userId - The caller; drives `ownIntent` and `pressWouldSpawnNow`.
 * @param configuredEmoji - The admin indicator-emoji setting (raw), or null.
 * @param grouping - ROK-2352: registry + `?group`; absent = the whole game, folded.
 */
export async function readGroupDetail(
  db: LfgDb,
  game: typeof schema.games.$inferSelect,
  userId: number,
  configuredEmoji: string | null = null,
  grouping?: { registry: LfgGroupingRegistry; groupKey: string | undefined },
): Promise<LfgGroupDetailDto> {
  const group = await resolveGroupFor(game, grouping);
  const { scope } = group;
  const [summary, members, live, threadId, convertedEvent, others] =
    await Promise.all([
      getGroupSummary(db, game, userId, scope),
      listGroupMembers(db, game.id, scope),
      findOwnLiveHand(db, userId, game.id, scope),
      findOpenForumThreadId(db, game.id),
      readConvertedEvent(db, game.id),
      listOwnOtherGroups(db, userId, game.id, group),
    ]);
  // ROK-2352: the plugin's per-member detail (badges) for the viewed group.
  const adapter = adapterFor(game, grouping);
  const roster = await attachMemberDetails(
    db,
    adapter,
    game.id,
    scope,
    members,
  );
  const spawns = groupReadPressWouldSpawnNow(summary, live?.urgency === 'now');
  return {
    ...summary,
    groupKey: scope ?? '',
    groupLabel: group.label,
    ...(group.describe ? { ownOtherGroups: others } : {}),
    members: roster,
    ownIntent: live ? toIntentDto(live) : null,
    threadId,
    convertedEvent,
    // AC7 — the SAME predicate the board card asks, with the per-viewer
    // refinement the card cannot have (AC1/AC2): a viewer already holding a
    // now-hand cannot cross anything by pressing again.
    pressWouldSpawnNow: spawns,
    // The shared resolver with no guild cache: the web cannot draw a custom
    // Discord emoji, so a custom setting degrades to 🎉 here (AC5).
    ...(spawns
      ? { spawnIndicatorEmoji: resolveNowIndicatorEmoji(configuredEmoji).name }
      : {}),
  };
}
