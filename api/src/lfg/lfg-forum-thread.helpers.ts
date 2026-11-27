/**
 * ROK-2352 — the group page's open forum thread, out of `lfg-query.helpers.ts`
 * (line budget). Re-exported from there, so callers and mocks are unchanged.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import type { LfgGroupScope } from './lfg-group-scope.helpers';

/**
 * The live forum thread of a game's LFG group, or null.
 *
 * ROK-1483 A10: `LfgGroupDetailDto.threadId` is how the web learns which
 * thread the conversation panel should read — the alternative was a second
 * endpoint and a second round trip on every group-page load.
 *
 * Scoped to the `open` row on purpose: the group PAGE shows the live group, so
 * a closed group's old thread must not surface under a new one. The read
 * endpoint's own resolver is deliberately broader, because history stays
 * readable after a group closes (D12).
 *
 * @param db - Drizzle handle.
 * @param gameId - The game whose group is being read.
 * @param scope - ROK-2352 (review MAJOR-3): the group's own post only; the
 *   fold (null) reads the whole-game `''` post.
 * @returns The Discord thread id, or null when the group has no forum post.
 */
export async function findOpenForumThreadId(
  db: LfgDb,
  gameId: number,
  scope: LfgGroupScope = null,
): Promise<string | null> {
  const [row] = await db
    .select({ threadId: schema.lfgGroupMessages.threadId })
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, gameId),
        eq(schema.lfgGroupMessages.groupKey, scope ?? ''),
        eq(schema.lfgGroupMessages.state, 'open'),
        eq(schema.lfgGroupMessages.postKind, 'forum'),
        isNotNull(schema.lfgGroupMessages.threadId),
      ),
    )
    .limit(1);
  return row?.threadId ?? null;
}
