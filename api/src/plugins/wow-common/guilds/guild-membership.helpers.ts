import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
  /** The user's character that links to the row (ROK-1794 delegation). */
  characterId: string;
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
      characterId: characters.id,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, characterLink())
    .innerJoin(users, eq(users.id, characters.userId))
    .where(and(eq(characters.userId, userId), liveLinkedMember(), scope));
}

/** SQL predicate shared by every linked-member read: active + latest snapshot. */
function liveLinkedMember(): SQL | undefined {
  return and(isNull(users.deactivatedAt), inLatestSnapshot());
}

/**
 * ROK-1832 D8: every user with a live linked member row in the guild — the
 * set form of `findLinkedMemberRows(db, userId, guildId)` (same joins, same
 * predicate), so a group fan-out matches the membership gate exactly.
 */
export async function findLinkedMemberUserIds(
  db: Db,
  guildId: number,
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: characters.userId })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, characterLink())
    .innerJoin(users, eq(users.id, characters.userId))
    .where(and(eq(guilds.id, guildId), liveLinkedMember()));
  return rows.map((r) => r.userId);
}

/** ROK-1794 (review): a live linked row of a granted member, with its owner. */
export interface MemberLinkRow extends LinkedMemberRow {
  userId: number;
  username: string;
}

/**
 * The live linked rows of these member ids in one guild — the same D3 joins
 * and filters as `findLinkedMemberRows`, keyed by member row instead of user.
 */
export async function findLinksOfMembers(
  db: Db,
  guildId: number,
  memberIds: number[],
): Promise<MemberLinkRow[]> {
  if (memberIds.length === 0) return [];
  return db
    .select({
      guildId: guildMembers.guildId,
      memberId: guildMembers.id,
      rankIndex: guildMembers.rankIndex,
      characterId: characters.id,
      userId: users.id,
      username: users.username,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, characterLink())
    .innerJoin(users, eq(users.id, characters.userId))
    .where(
      and(
        eq(guilds.id, guildId),
        inArray(guildMembers.id, memberIds),
        isNull(users.deactivatedAt),
        inLatestSnapshot(),
      ),
    )
    .orderBy(asc(users.id));
}

/** Is this member row in the guild's latest snapshot? */
export async function isLiveMemberOf(
  db: Db,
  guildId: number,
  memberId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: guildMembers.id })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(
      and(
        eq(guildMembers.id, memberId),
        eq(guildMembers.guildId, guildId),
        inLatestSnapshot(),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
