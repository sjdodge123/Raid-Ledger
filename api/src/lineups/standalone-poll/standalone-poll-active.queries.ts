/**
 * The active standalone-poll list — the events-page banner (ROK-1609/1750)
 * and, filtered by hub, the hub Events tab's "Open polls" (ROK-1893 P3).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ActiveStandalonePollDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { votableStandalonePollSql } from './standalone-poll-votable.helpers';

type Db = PostgresJsDatabase<typeof schema>;

// A type alias (not an interface) so it satisfies `Record<string, unknown>`.
type ActivePollRow = {
  matchId: number;
  visibility: 'public' | 'private';
  lineupId: number;
  gameName: string;
  gameCoverUrl: string | null;
  memberCount: number;
  slotCount: number;
  hubId: number | null;
  hubName: string | null;
};

/** An active-list item; `hub` only when the tagged hub is visible. */
export type ActiveStandalonePoll = ActiveStandalonePollDto & {
  visibility: 'public' | 'private';
  hub: { id: number; name: string } | null;
};

/** Hub-list filter: polls tagged to `hubId`, and only while that hub is visible. */
function hubFilterSql(hubId: number | undefined): SQL {
  return hubId === undefined
    ? sql``
    : sql`AND l.guild_id = ${hubId} AND hg.id IS NOT NULL`;
}

/** ROK-1750: public, staff, the creator, or an invitee. */
function callerCanSeeSql(caller: { id: number; isAdmin: boolean }): SQL {
  return sql`(
    l.visibility = 'public'
    OR ${caller.isAdmin}::boolean
    OR l.created_by = ${caller.id}
    OR EXISTS (
      SELECT 1 FROM community_lineup_invitees i
      WHERE i.lineup_id = l.id AND i.user_id = ${caller.id}
    )
  )`;
}

function toActivePoll(row: ActivePollRow): ActiveStandalonePoll {
  const { hubId, hubName, ...rest } = row;
  const hub =
    hubId !== null && hubName !== null ? { id: hubId, name: hubName } : null;
  return { ...rest, hub };
}

/**
 * Find all ACTIVE standalone polls the caller may see.
 *
 * ROK-1609: listed only while genuinely votable — see
 * `votableStandalonePollSql` (shared with the weekly digest, ROK-1771) — and
 * visible to the caller (public, admin, creator or invitee; ROK-1750).
 * ROK-1893 P3: `hub` comes from one LEFT JOIN on a VISIBLE community hub; a
 * `hubId` narrows the list to polls tagged to that hub.
 */
export async function findActiveStandalonePolls(
  db: Db,
  caller: { id: number; isAdmin: boolean },
  opts: { hubId?: number } = {},
): Promise<ActiveStandalonePoll[]> {
  const rows = await db.execute<ActivePollRow>(sql`
    SELECT m.id AS "matchId", m.lineup_id AS "lineupId",
           l.visibility AS "visibility",
           g.name AS "gameName", g.cover_url AS "gameCoverUrl",
           COALESCE(mem.cnt, 0)::int AS "memberCount",
           COALESCE(sl.cnt, 0)::int AS "slotCount",
           hg.id AS "hubId", hg.name AS "hubName"
    FROM community_lineup_matches m
    JOIN community_lineups l ON l.id = m.lineup_id
    JOIN games g ON g.id = m.game_id
    LEFT JOIN guilds hg ON hg.id = l.guild_id
      AND hg.kind = 'game_community' AND hg.status = 'active'
      AND hg.hidden_at IS NULL
    LEFT JOIN (SELECT match_id, COUNT(*)::int AS cnt FROM community_lineup_match_members GROUP BY match_id) mem ON mem.match_id = m.id
    LEFT JOIN (SELECT match_id, COUNT(*)::int AS cnt FROM community_lineup_schedule_slots GROUP BY match_id) sl ON sl.match_id = m.id
    WHERE ${votableStandalonePollSql()}
      ${hubFilterSql(opts.hubId)}
      AND ${callerCanSeeSql(caller)}
    ORDER BY m.created_at DESC
  `);
  return [...rows].map(toActivePoll);
}
