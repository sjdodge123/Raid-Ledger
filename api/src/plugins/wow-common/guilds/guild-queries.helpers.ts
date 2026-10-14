import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterGuild, GuildSummary } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { inLatestSnapshot, toGuildSummary } from './guild-membership.helpers';

/** ROK-1785 — read queries behind the guild endpoints (no access logic). */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, users } = schema;

export async function findGuild(
  db: Db,
  guildId: number,
): Promise<schema.GuildSelect | null> {
  const [row] = await db
    .select()
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  return row ?? null;
}

/** Username of whoever captured the latest snapshot's rows, if known. */
export async function findImportedBy(
  db: Db,
  guildId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ username: users.username })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(users, eq(users.id, guildMembers.capturedByUserId))
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()))
    .orderBy(desc(guildMembers.updatedAt))
    .limit(1);
  return row?.username ?? null;
}

/** Every guild of one game, by name (staff view of the game page list). */
export async function listGuildsOfGame(
  db: Db,
  gameId: number,
): Promise<GuildSummary[]> {
  const rows = await db
    .select()
    .from(guilds)
    .where(eq(guilds.gameId, gameId))
    .orderBy(asc(guilds.name));
  return rows.map(toGuildSummary);
}

/** `rank_name` per guild_members id (the viewer's own rows). */
export async function rankNamesByMemberId(
  db: Db,
  memberIds: number[],
): Promise<Map<number, string | null>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db
    .select({ id: guildMembers.id, rankName: guildMembers.rankName })
    .from(guildMembers)
    .where(inArray(guildMembers.id, memberIds));
  return new Map(rows.map((r) => [r.id, r.rankName]));
}

/** rank_index → rank_name in the guild's latest snapshot. */
export async function rankNamesInSnapshot(
  db: Db,
  guildId: number,
): Promise<Map<number, string | null>> {
  const rows = await db
    .selectDistinct({
      rankIndex: guildMembers.rankIndex,
      rankName: guildMembers.rankName,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
  const map = new Map<number, string | null>();
  for (const r of rows) {
    if (r.rankIndex !== null && !map.has(r.rankIndex)) {
      map.set(r.rankIndex, r.rankName);
    }
  }
  return map;
}

/**
 * The guild a character is in now: its `addon_guid` on a latest-snapshot
 * member row of a guild of the same game. Newest snapshot wins.
 */
export async function findCharacterGuild(
  db: Db,
  characterId: string,
): Promise<Omit<NonNullable<CharacterGuild['data']>, 'viewerCanOpen'> | null> {
  const [row] = await db
    .select({ guild: guilds, rankName: guildMembers.rankName })
    .from(characters)
    .innerJoin(guildMembers, eq(guildMembers.guid, characters.addonGuid))
    .innerJoin(
      guilds,
      and(
        eq(guilds.id, guildMembers.guildId),
        eq(guilds.gameId, characters.gameId),
      ),
    )
    .where(
      and(
        eq(characters.id, characterId),
        isNotNull(characters.addonGuid),
        inLatestSnapshot(),
      ),
    )
    .orderBy(desc(guilds.lastSnapshotAt))
    .limit(1);
  if (!row) return null;
  return { guild: toGuildSummary(row.guild), rankName: row.rankName };
}
