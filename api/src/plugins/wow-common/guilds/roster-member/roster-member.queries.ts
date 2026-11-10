import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { characterLink, inLatestSnapshot } from '../guild-membership.helpers';
import { ownerIsActive } from '../guild-roster.helpers';
import {
  isClaimableGuild,
  isRowUnclaimed,
} from '../roster-claim/roster-claim.queries';

/**
 * ROK-2149 — the roster-member page's reads. The member must be in hub
 * `guildId`'s LATEST roster; the snapshot is joined by member id only and
 * verified in TS (`isVerifiedSnapshot`) so an unverified row can still
 * give its `last_error` to the D1 reason (AC-4).
 */
type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers: m, guildMemberArmory: a, characters } = schema;

/** One member row with its guild, raw snapshot and derived claim facts. */
export interface RosterMemberRow {
  memberId: number;
  guildId: number;
  gameId: number;
  region: string;
  name: string;
  level: number | null;
  class: string | null;
  rankIndex: number | null;
  rankName: string | null;
  onlineAtExport: boolean | null;
  lastOnlineDays: number | null;
  blizzardCharacterId: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** Same derivation as the Members row's `characterId` (active owner). */
  claimedCharacterId: string | null;
  /** `isRowUnclaimed` — any owner, active or not. */
  unclaimed: boolean;
  snapshot: RosterMemberSnapshot | null;
}

/** The `guild_member_armory` columns the page reads. */
export interface RosterMemberSnapshot {
  blizzardCharacterId: number | null;
  level: number | null;
  class: string | null;
  race: string | null;
  spec: string | null;
  role: string | null;
  itemLevel: number | null;
  avatarUrl: string | null;
  equipment: unknown;
  talents: unknown;
  armoryProfessions: unknown;
  syncedAt: Date | null;
  lastError: string | null;
}

const snapshotColumns = {
  blizzardCharacterId: a.blizzardCharacterId,
  level: a.level,
  class: a.class,
  race: a.race,
  spec: a.spec,
  role: a.role,
  itemLevel: a.itemLevel,
  avatarUrl: a.avatarUrl,
  equipment: a.equipment,
  talents: a.talents,
  armoryProfessions: a.armoryProfessions,
  syncedAt: a.syncedAt,
  lastError: a.lastError,
};

const memberColumns = {
  memberId: m.id,
  guildId: guilds.id,
  gameId: guilds.gameId,
  region: guilds.region,
  name: m.characterName,
  level: m.level,
  class: m.class,
  rankIndex: m.rankIndex,
  rankName: m.rankName,
  onlineAtExport: m.onlineAtExport,
  lastOnlineDays: m.lastOnlineDays,
  blizzardCharacterId: m.blizzardCharacterId,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
  claimedCharacterId: characters.id,
  unclaimed: sql<boolean>`coalesce(${isRowUnclaimed() ?? sql`false`}, false)`,
  snapshotMemberId: a.guildMemberId,
};

/** The member of hub `guildId` in its latest roster, or null (404). */
export async function loadRosterMember(
  db: Db,
  guildId: number,
  memberId: number,
): Promise<RosterMemberRow | null> {
  const [row] = await db
    .select({ ...memberColumns, snap: snapshotColumns })
    .from(m)
    .innerJoin(guilds, eq(guilds.id, m.guildId))
    .leftJoin(a, eq(a.guildMemberId, m.id))
    .leftJoin(characters, and(characterLink(), ownerIsActive()))
    .where(and(eq(m.id, memberId), eq(m.guildId, guildId), inLatestSnapshot()))
    .limit(1);
  if (!row) return null;
  const { snap, snapshotMemberId, ...rest } = row;
  return { ...rest, snapshot: snapshotMemberId === null ? null : snap };
}

/** The roster-claim pick-list rule for this one guild (`isClaimableGuild`). */
export async function isGuildClaimable(
  db: Db,
  gameId: number,
  guildId: number,
): Promise<boolean> {
  const [hit] = await db
    .select({ id: guilds.id })
    .from(guilds)
    .where(isClaimableGuild(gameId, guildId))
    .limit(1);
  return hit !== undefined;
}
