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

/**
 * Every live group the viewer has a hand in, ordered like `GET /lfg`.
 *
 * @param db - Drizzle handle.
 * @param viewerId - Whose hands to read.
 */
export async function listOwnActiveGroups(
  db: LfgDb,
  viewerId: number,
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
        VISIBILITY_FILTER(),
        inArray(schema.lfgIntents.gameId, ownLiveIntents(db, viewerId, now)),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(desc(count()), asc(min(schema.lfgIntents.expiresAt)));
  return rows.map((r) => toGroupSummary(r));
}
