import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CharacterRoleSchema,
  type CharacterRole,
  type GuildMemberRow,
  type GuildRankGroup,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { characterLink, inLatestSnapshot } from './guild-membership.helpers';

/**
 * ROK-1785 — the guild page roster: latest-snapshot `guild_members` rows,
 * each LEFT-joined to the RL character that carries its GUID (same game) for
 * the character link (D9) and the role. Grouped by rank, sorted by name.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, users } = schema;

/** The character's owner is active — a deactivated user's characters never link (D3). */
export function ownerIsActive() {
  return sql`exists (select 1 from ${users} where ${users.id} = ${characters.userId} and ${users.deactivatedAt} is null)`;
}

/** One raw roster row as the query returns it. */
export interface RawRosterRow {
  memberId: number;
  name: string;
  class: string | null;
  level: number | null;
  rankIndex: number | null;
  rankName: string | null;
  characterId: string | null;
  /** Owner of the linked character (null when unlinked). */
  userId: number | null;
  role: string | null;
  roleOverride: string | null;
  isMain: boolean | null;
}

/** `roleOverride ?? role`, narrowed to the contract's role enum. */
export function effectiveRole(row: RawRosterRow): CharacterRole | null {
  const parsed = CharacterRoleSchema.safeParse(row.roleOverride ?? row.role);
  return parsed.success ? parsed.data : null;
}

/** STAFF-ONLY roster link details, by linked character id (ROK-1794). */
export type RosterLinks = Map<
  string,
  NonNullable<GuildMemberRow['linkedAccount']>
>;

export function toMemberRow(
  row: RawRosterRow,
  links?: RosterLinks,
): GuildMemberRow {
  const account =
    row.characterId === null ? undefined : links?.get(row.characterId);
  return {
    memberId: row.memberId,
    name: row.name,
    class: row.class,
    level: row.level,
    rankIndex: row.rankIndex,
    rankName: row.rankName,
    effectiveRole: effectiveRole(row),
    characterId: row.characterId,
    isMain: row.isMain ?? false,
    ...(account ? { linkedAccount: account } : {}),
  };
}

/** One row per member: a GUID can match characters in several regions. */
export function dedupeByMember(rows: RawRosterRow[]): RawRosterRow[] {
  const seen = new Map<number, RawRosterRow>();
  for (const row of rows) {
    const prev = seen.get(row.memberId);
    if (!prev || (row.isMain && !prev.isMain)) seen.set(row.memberId, row);
  }
  return [...seen.values()];
}

/** Rank ascending (null ranks last), then name (case-insensitive). */
export function compareRosterRows(a: RawRosterRow, b: RawRosterRow): number {
  const ra = a.rankIndex ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rankIndex ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * Group sorted rows by rank; the group's name is its first row's rank name.
 * `links` is passed for staff viewers only (ROK-1794) — never for anyone else.
 */
export function groupRoster(
  rows: RawRosterRow[],
  links?: RosterLinks,
): GuildRankGroup[] {
  const sorted = dedupeByMember(rows).sort(compareRosterRows);
  const groups: GuildRankGroup[] = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.rankIndex === row.rankIndex) {
      last.members.push(toMemberRow(row, links));
      continue;
    }
    groups.push({
      rankIndex: row.rankIndex,
      rankName: row.rankName,
      members: [toMemberRow(row, links)],
    });
  }
  return groups;
}

/** The guild's latest-snapshot roster rows, joined to linked characters. */
export async function loadRosterRows(
  db: Db,
  guildId: number,
): Promise<RawRosterRow[]> {
  return db
    .select({
      memberId: guildMembers.id,
      name: guildMembers.characterName,
      class: guildMembers.class,
      level: guildMembers.level,
      rankIndex: guildMembers.rankIndex,
      rankName: guildMembers.rankName,
      characterId: characters.id,
      userId: characters.userId,
      role: characters.role,
      roleOverride: characters.roleOverride,
      isMain: characters.isMain,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(
      characters,
      and(isNotNull(guildMembers.guid), characterLink(), ownerIsActive()),
    )
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()))
    .orderBy(asc(guildMembers.rankIndex), asc(guildMembers.characterName));
}
