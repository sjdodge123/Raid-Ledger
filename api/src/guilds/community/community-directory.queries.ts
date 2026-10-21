import { BadRequestException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  HubDirectoryEntry,
  HubDirectoryPage,
  HubDirectoryQuery,
  HubViewerState,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  decodeCursor,
  type DirectoryCursor,
} from './community-directory.cursor';
import { escapeLike, pageOf } from './community-directory.params';
import { viewerStateOf } from './community-ladder.helpers';
import {
  joinedPredicate,
  viewerRow,
  visibleKinds,
  type DirectoryScope,
} from './community-directory.visibility';

/**
 * ROK-1870 L3 / ROK-1875 L2 — `GET /hubs`: every hub kind in the scope, each
 * under its own visibility rule, keyset-paged per sort (M12). The viewer's
 * own community row rides along as `viewer_row`.
 */

type Db = PostgresJsDatabase<typeof schema>;
const g = schema.guilds;
const games = schema.games;

/** `created_at` at microsecond precision — the `newest` cursor key. */
const CREATED_KEY = sql<string>`to_char(${g.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The live Leader's display name (active accounts only). */
const LEADER_NAME = sql<string | null>`(
  SELECT COALESCE(lu.display_name, lu.username)
  FROM hub_community_members lm JOIN users lu ON lu.id = lm.user_id
  WHERE lm.guild_id = ${g.id} AND lm.role = 'leader' AND lm.left_at IS NULL
    AND lm.banned_at IS NULL AND lu.deactivated_at IS NULL
  LIMIT 1)`;

const ORDER: Record<HubDirectoryQuery['sort'], SQL[]> = {
  members: [desc(g.memberCount), desc(g.id)],
  name: [asc(g.nameKey), asc(g.id)],
  newest: [desc(g.createdAt), desc(g.id)],
};

/** The filters shared by the page and its `total`. */
function filtersOf(query: HubDirectoryQuery, scope: DirectoryScope): SQL[] {
  const conds: SQL[] = [visibleKinds(scope)];
  if (query.gameId !== undefined) conds.push(eq(g.gameId, query.gameId));
  if (query.q) {
    conds.push(ilike(g.nameKey, `%${escapeLike(query.q.toLowerCase())}%`));
  }
  const joined = joinedPredicate(scope);
  if (query.membership === 'joined') conds.push(joined);
  if (query.membership === 'not-joined') conds.push(sql`NOT ${joined}`);
  return conds;
}

/** Rows strictly after the cursor in the sort's order; 400 on a bad key. */
function afterCursor(c: DirectoryCursor): SQL {
  if (c.s === 'members') {
    const n = Number(c.v);
    if (!Number.isInteger(n)) throw new BadRequestException('Invalid cursor');
    return sql`(${g.memberCount}, ${g.id}) < (${n}::int, ${c.id}::int)`;
  }
  if (c.s === 'name') {
    return sql`(${g.nameKey}, ${g.id}) > (${c.v}::text, ${c.id}::int)`;
  }
  if (Number.isNaN(Date.parse(c.v))) {
    throw new BadRequestException('Invalid cursor');
  }
  return sql`(${g.createdAt}, ${g.id}) < (${c.v}::timestamptz, ${c.id}::int)`;
}

function selectRows(db: Db, viewerId: number, where: SQL[], order: SQL[]) {
  return db
    .select({
      id: g.id,
      kind: g.kind,
      gameId: g.gameId,
      gameName: games.name,
      gameIconUrl: games.coverUrl,
      name: g.name,
      blurb: g.blurb,
      memberCount: g.memberCount,
      nameKey: g.nameKey,
      createdKey: CREATED_KEY,
      leaderName: LEADER_NAME,
      vRole: viewerRow.role,
      vLeft: viewerRow.leftAt,
      vBanned: viewerRow.bannedAt,
    })
    .from(g)
    .innerJoin(games, eq(games.id, g.gameId))
    .leftJoin(viewerRow, viewerJoin(viewerId))
    .where(and(...where))
    .orderBy(...order);
}

function viewerJoin(viewerId: number): SQL | undefined {
  return and(eq(viewerRow.guildId, g.id), eq(viewerRow.userId, viewerId));
}

type DirectoryRow = Awaited<ReturnType<typeof selectRows>>[number];

/** Community: the ladder state from `viewer_row`; other kinds: D9 ids. */
function viewerOf(r: DirectoryRow, memberIds: number[]): HubViewerState {
  if (r.kind !== 'game_community') {
    return memberIds.includes(r.id) ? 'member' : 'not-member';
  }
  const own =
    r.vRole === null
      ? null
      : { role: r.vRole, leftAt: r.vLeft, bannedAt: r.vBanned };
  return viewerStateOf(own);
}

function toEntry(r: DirectoryRow, memberIds: number[]): HubDirectoryEntry {
  const community = r.kind === 'game_community';
  return {
    id: r.id,
    kind: r.kind,
    gameId: r.gameId,
    gameName: r.gameName,
    gameIconUrl: r.gameIconUrl,
    name: r.name,
    blurb: r.blurb,
    memberCount: r.memberCount,
    leaderName: community ? r.leaderName : null,
    viewer: viewerOf(r, memberIds),
  };
}

function keyOf(sort: HubDirectoryQuery['sort'], r: DirectoryRow) {
  const v =
    sort === 'members'
      ? String(r.memberCount)
      : sort === 'name'
        ? r.nameKey
        : r.createdKey;
  return { s: sort, v, id: r.id };
}

async function countRows(db: Db, viewerId: number, where: SQL[]) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(g)
    .innerJoin(games, eq(games.id, g.gameId))
    .leftJoin(viewerRow, viewerJoin(viewerId))
    .where(and(...where));
  return row?.n ?? 0;
}

/** A directory page before the service adds the live `kinds`. */
export type DirectoryResult = Omit<HubDirectoryPage, 'kinds'>;

/** One directory page for `viewerId` within `scope` (cursor 400s per M12). */
export async function listDirectory(
  db: Db,
  viewerId: number,
  query: HubDirectoryQuery,
  scope: DirectoryScope,
): Promise<DirectoryResult> {
  const cursor = decodeCursor(query.cursor, query.sort);
  const where = filtersOf(query, scope);
  const paged = cursor === null ? where : [...where, afterCursor(cursor)];
  const [rows, total] = await Promise.all([
    selectRows(db, viewerId, paged, ORDER[query.sort]).limit(query.limit + 1),
    countRows(db, viewerId, where),
  ]);
  const page = pageOf(rows, query.limit, (r) => keyOf(query.sort, r));
  const items = page.items.map((r) => toEntry(r, scope.memberIds));
  return { items, nextCursor: page.nextCursor, total };
}
