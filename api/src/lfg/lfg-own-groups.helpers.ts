/**
 * ROK-1660 — the caller's OWN live LFG groups, read directly.
 *
 * `listActiveGroups` caps the GLOBAL list at `LFG_LIST_LIMIT` before anyone
 * filters it to `hasOwnIntent`, so a caller whose group sorts past the cap
 * (a quiet game on a busy server) would vanish from `/lfg-leave` — and
 * `All my LFGs` would leave their hand up while saying it was gone. This read
 * starts from the caller's own active intents instead, so it has no global
 * LIMIT: one row per game the caller holds a live hand in, with that group's
 * full counts. Read-only; the write is still `LfgService.withdraw`.
 *
 * The display reads (My LFGs, `/lfg list`, autocomplete) apply the game
 * visibility filter like every other game list. Bulk withdrawal must NOT: a
 * hand on a game the admin later hid or banned would otherwise survive
 * `All my LFGs` while the reply said it was gone, and reappear on unhide.
 */
import { and, asc, count, desc, eq, inArray, min } from 'drizzle-orm';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { VISIBILITY_FILTER } from '../igdb/igdb-visibility.helpers';
import {
  groupColumns,
  liveIntent,
  ownLiveIntents,
  toGroupSummary,
  type LfgDb,
} from './lfg-query.helpers';

/** How {@link listOwnActiveGroups} treats hidden / banned games. */
export interface OwnGroupsOptions {
  /** Include hands on hidden or banned games — bulk withdrawal only. */
  includeHidden?: boolean;
}

/**
 * Every live group the viewer has a hand in, ordered like `GET /lfg`.
 *
 * @param db - Drizzle handle.
 * @param viewerId - Whose hands to read.
 * @param opts - `includeHidden` drops the game visibility filter.
 */
export async function listOwnActiveGroups(
  db: LfgDb,
  viewerId: number,
  opts: OwnGroupsOptions = {},
): Promise<LfgGroupSummaryDto[]> {
  const now = new Date();
  const rows = await db
    .select(groupColumns(viewerId))
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .where(
      and(
        liveIntent(now),
        opts.includeHidden ? undefined : VISIBILITY_FILTER(),
        inArray(schema.lfgIntents.gameId, ownLiveIntents(db, viewerId, now)),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(desc(count()), asc(min(schema.lfgIntents.expiresAt)));
  return rows.map((r) => toGroupSummary(r));
}

/**
 * Eligible live hands on ONE game — the `N still looking` after a leave.
 * Game-scoped, so unlike a lookup in the capped `GET /lfg` list it cannot
 * report 0 for a group that merely sorts past `LFG_LIST_LIMIT`.
 *
 * @param db - Drizzle handle.
 * @param gameId - The group's game.
 */
export async function countLiveIntents(
  db: LfgDb,
  gameId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(and(eq(schema.lfgIntents.gameId, gameId), liveIntent(new Date())));
  return row?.n ?? 0;
}
