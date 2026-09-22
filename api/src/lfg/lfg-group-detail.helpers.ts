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
import { findActiveIntent, toIntentDto } from './lfg-write.helpers';

/**
 * Summary, roster, the caller's own live row, the forum thread, the converted
 * event — and whether the caller's `Right now` hand would form the group.
 *
 * @param db - Drizzle handle.
 * @param game - The already-loaded game row.
 * @param userId - The caller; drives `ownIntent` and `pressWouldSpawnNow`.
 * @param configuredEmoji - The admin indicator-emoji setting (raw), or null.
 */
export async function readGroupDetail(
  db: LfgDb,
  game: typeof schema.games.$inferSelect,
  userId: number,
  configuredEmoji: string | null = null,
): Promise<LfgGroupDetailDto> {
  const [summary, members, own, threadId, convertedEvent] = await Promise.all([
    getGroupSummary(db, game, userId),
    listGroupMembers(db, game.id),
    findActiveIntent(db, userId, game.id),
    findOpenForumThreadId(db, game.id),
    readConvertedEvent(db, game.id),
  ]);
  const live = own && own.expiresAt > new Date() ? own : null;
  const spawns = groupReadPressWouldSpawnNow(summary, live?.urgency === 'now');
  return {
    ...summary,
    members,
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
