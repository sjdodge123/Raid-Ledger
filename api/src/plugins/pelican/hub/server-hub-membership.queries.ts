import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { serverHubMemberPredicate } from './server-hub-membership.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
const m = schema.hubServerMembers;

/** One presence sighting of a linked user on a hub's server. */
export interface HubSighting {
  guildId: number;
  userId: number;
  characterName: string | null;
  at: Date;
}

/**
 * Upsert a sighting (GREATEST/COALESCE — idempotent). `rejoin` = a presence
 * transition: it clears `left_at`. A plain "still online" touch does not, and
 * skips a row the user left, so Leave sticks until they are next seen arriving.
 */
export async function upsertSighting(
  db: Executor,
  s: HubSighting,
  rejoin: boolean,
): Promise<void> {
  await db
    .insert(m)
    .values({
      guildId: s.guildId,
      userId: s.userId,
      source: 'presence',
      firstSeenAt: s.at,
      lastSeenAt: s.at,
      characterName: s.characterName?.slice(0, 64) ?? null,
    })
    .onConflictDoUpdate({
      target: [m.guildId, m.userId],
      set: {
        lastSeenAt: sql`GREATEST(${m.lastSeenAt}, excluded.last_seen_at)`,
        firstSeenAt: sql`COALESCE(${m.firstSeenAt}, excluded.first_seen_at)`,
        characterName: sql`COALESCE(excluded.character_name, ${m.characterName})`,
        source: sql`CASE WHEN ${m.joinedAt} IS NULL THEN 'presence' ELSE ${m.source} END`,
        ...(rejoin ? { leftAt: null } : {}),
        updatedAt: s.at,
      },
      ...(rejoin ? {} : { setWhere: isNull(m.leftAt) }),
    });
}

/** Hub guild id per Pelican server id (hidden hubs included — L-5). */
export async function hubIdsForServers(
  db: Executor,
  serverIds: number[],
): Promise<Map<number, number>> {
  if (serverIds.length === 0) return new Map();
  const g = schema.guilds;
  const rows = await db
    .select({ id: g.id, serverId: g.pelicanServerId })
    .from(g)
    .where(inArray(g.pelicanServerId, serverIds));
  return new Map(
    rows.flatMap((r) => (r.serverId === null ? [] : [[r.serverId, r.id]])),
  );
}

/** Linked RL user id per SteamID64 (L-7: unlinked SteamIDs are dropped). */
export async function usersBySteamId(
  db: Executor,
  steamIds: string[],
): Promise<Map<string, number>> {
  if (steamIds.length === 0) return new Map();
  const u = schema.users;
  const rows = await db
    .select({ id: u.id, steamId: u.steamId })
    .from(u)
    .where(and(inArray(u.steamId, steamIds), isNotNull(u.steamId)));
  return new Map(
    rows.flatMap((r) => (r.steamId === null ? [] : [[r.steamId, r.id]])),
  );
}

/** Is the user a member of this server hub right now (L-2)? */
export async function isServerHubMemberRow(
  db: Executor,
  guildId: number,
  userId: number,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: m.id })
    .from(m)
    .where(
      and(
        eq(m.guildId, guildId),
        eq(m.userId, userId),
        serverHubMemberPredicate(now),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Visible server hubs the user is a member of. */
export async function memberServerHubIds(
  db: Executor,
  userId: number,
  now: Date,
): Promise<number[]> {
  const g = schema.guilds;
  const rows = await db
    .select({ id: m.guildId })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .where(
      and(
        eq(m.userId, userId),
        isNull(g.hiddenAt),
        eq(g.kind, 'game_server'),
        serverHubMemberPredicate(now),
      ),
    );
  return rows.map((r) => r.id);
}

/** Keep `guilds.member_count` equal to the live member count. */
export async function refreshMemberCount(
  db: Executor,
  guildId: number,
  now: Date,
): Promise<void> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.guildId, guildId), serverHubMemberPredicate(now)));
  await db
    .update(schema.guilds)
    .set({ memberCount: row?.n ?? 0 })
    .where(eq(schema.guilds.id, guildId));
}
