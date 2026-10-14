import { and, eq, gte, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildSummary } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';

/**
 * ROK-1785 D3 — THE guild-membership definition. Never re-derive it.
 *
 * A user is a member of a guild when they are active (`deactivated_at` NULL)
 * and own >=1 character of the guild's game (and region, when the character's
 * is known) whose `addon_guid` equals a
 * `guild_members.guid` row of that guild that is NOT soft-removed. The
 * LedgerLink import stamps every member of a snapshot with
 * `last_seen_at = snapshotAt` and the guild with `last_snapshot_at =
 * snapshotAt` (`addon-import-guild.apply.ts` `guildSet` / `memberValues`), so
 * "in the latest snapshot" is `last_seen_at >= guilds.last_snapshot_at`. A
 * guild with no snapshot timestamp (non-addon source) counts every row.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, users } = schema;

/** One live guild-member row the user is linked to through a character. */
export interface LinkedMemberRow {
  guildId: number;
  memberId: number;
  rankIndex: number | null;
}

/** SQL predicate: the member row is in its guild's latest snapshot. */
export function inLatestSnapshot(): SQL | undefined {
  return or(
    isNull(guilds.lastSnapshotAt),
    gte(guildMembers.lastSeenAt, guilds.lastSnapshotAt),
  );
}

/**
 * Same region, or the character's region is unknown. GUIDs are only unique
 * per region (`characters` unique index is game + region + addon_guid), so a
 * same-GUID character in another region is a different player. `guilds.region`
 * is NOT NULL; a NULL character region falls back to GUID + game.
 */
export function sameRegionOrUnknown(): SQL | undefined {
  return or(
    isNull(characters.region),
    sql`lower(${characters.region}) = lower(${guilds.region})`,
  );
}

/** Join: the member's GUID on a character of the guild's game and region. */
export function characterLink(): SQL | undefined {
  return and(
    eq(characters.addonGuid, guildMembers.guid),
    eq(characters.gameId, guilds.gameId),
    sameRegionOrUnknown(),
  );
}

/**
 * The user's live member rows — in one guild, or in every guild when
 * `guildId` is omitted. Empty for a deactivated user or a non-member.
 */
export async function findLinkedMemberRows(
  db: Db,
  userId: number,
  guildId?: number,
): Promise<LinkedMemberRow[]> {
  const scope = guildId === undefined ? undefined : eq(guilds.id, guildId);
  return db
    .select({
      guildId: guildMembers.guildId,
      memberId: guildMembers.id,
      rankIndex: guildMembers.rankIndex,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, characterLink())
    .innerJoin(users, eq(users.id, characters.userId))
    .where(
      and(
        eq(characters.userId, userId),
        isNull(users.deactivatedAt),
        inLatestSnapshot(),
        scope,
      ),
    );
}

/** Row shape → contract `GuildSummary` (ISO timestamps). */
export function toGuildSummary(row: schema.GuildSelect): GuildSummary {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    region: row.region,
    realmSlug: row.realmSlug,
    faction: row.faction,
    memberCount: row.memberCount,
    lastSnapshotAt: row.lastSnapshotAt?.toISOString() ?? null,
  };
}
