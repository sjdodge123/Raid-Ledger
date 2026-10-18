import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildPageServer } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { toGameServerState } from '../pelican-state.helpers';
import { serverHubMemberPredicate } from './server-hub-membership.helpers';
import type { ServerMemberRecord } from './server-hub-page.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Live members of a server hub (L-2), with their linked SteamID for "online now". */
export async function loadServerMembers(
  db: Db,
  guildId: number,
  now: Date,
): Promise<ServerMemberRecord[]> {
  const m = schema.hubServerMembers;
  const u = schema.users;
  const rows = await db
    .select({
      memberId: m.id,
      userId: m.userId,
      username: u.username,
      displayName: u.displayName,
      steamId: u.steamId,
      source: m.source,
      lastSeenAt: m.lastSeenAt,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      characterName: m.characterName,
    })
    .from(m)
    .innerJoin(u, eq(u.id, m.userId))
    .where(and(eq(m.guildId, guildId), serverHubMemberPredicate(now)));
  return rows.map(({ username, displayName, ...r }) => ({
    ...r,
    name: displayName ?? username,
  }));
}

/** The hero block's server fields; undefined when the server is gone or unmapped. */
export async function loadServerBlock(
  db: Db,
  pelicanServerId: number | null,
  now: Date,
): Promise<Omit<GuildPageServer, 'viewerJoined'> | undefined> {
  if (pelicanServerId === null) return undefined;
  const s = schema.pelicanServers;
  const g = schema.games;
  const [row] = await db
    .select({
      currentState: s.currentState,
      isSuspended: s.isSuspended,
      statusCheckedAt: s.statusCheckedAt,
      gameSlug: g.slug,
      gameIconUrl: g.coverUrl,
    })
    .from(s)
    .innerJoin(g, eq(g.id, s.gameId))
    .where(eq(s.id, pelicanServerId))
    .limit(1);
  if (!row) return undefined;
  return {
    pelicanServerId,
    gameSlug: row.gameSlug,
    gameIconUrl: row.gameIconUrl,
    state: toGameServerState(row, now),
  };
}
