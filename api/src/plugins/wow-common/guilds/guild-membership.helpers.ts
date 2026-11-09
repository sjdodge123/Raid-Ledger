import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import {
  characterLink,
  inLatestSnapshot,
  linkVia,
  type LinkVia,
} from './guild-link.predicates';

export {
  blizzardIdLink,
  characterLink,
  guidLink,
  inLatestSnapshot,
  sameRegionOrUnknown,
  type LinkVia,
} from './guild-link.predicates';

/**
 * ROK-1785 D3 — THE guild-membership definition. Never re-derive it.
 *
 * A user is a member of a guild when they are active (`deactivated_at` NULL)
 * and own >=1 character that links (`characterLink()`, `guild-link.predicates.ts`:
 * LedgerLink GUID, else Blizzard character id — ROK-2115) to a
 * `guild_members` row of that guild that is NOT soft-removed. The
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
  /** ROK-2115: which arm linked it — `'blizzard'` = Armory id only, no GUID. */
  via: LinkVia;
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
      via: linkVia(),
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, characterLink())
    .innerJoin(users, eq(users.id, characters.userId))
    .where(and(eq(characters.userId, userId), liveLinkedMember(), scope));
}

/**
 * ROK-1815: whether any of the viewer's live rows is rank 0 (the GM) in the
 * latest snapshot — the hero's "Guild Master" label. Display only. ROK-2115
 * Ruling 1: only a GUID-linked row counts, the same rule as `holdsTopRank`.
 */
export function holdsGuildMasterRank(
  rows: Pick<LinkedMemberRow, 'rankIndex' | 'via'>[],
): boolean {
  return rows.some((r) => r.via === 'guid' && r.rankIndex === 0);
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
      via: linkVia(),
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
