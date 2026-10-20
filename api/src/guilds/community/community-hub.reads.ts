import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  liveMemberPredicate,
  type DbOrTx,
} from './community-membership.queries';
import type { CommunityMemberRecord } from './community-hub-page.helpers';
import type { DiscordGuildMemberFields } from './discord-guild-member.helpers';

/** ROK-1870 L2a — adapter reads: live members of ACTIVE hubs, active users. */

type Db = PostgresJsDatabase<typeof schema>;
const m = schema.hubCommunityMembers;
const g = schema.guilds;
const u = schema.users;

/** Live row + active hub + active user (the `isMember` gate). */
function liveInActiveHub() {
  return and(
    liveMemberPredicate(),
    eq(g.status, 'active'),
    isNull(u.deactivatedAt),
  );
}

/** The viewer's live role in an active hub, or null. */
export async function liveCommunityRole(
  db: DbOrTx,
  guildId: number,
  userId: number,
): Promise<CommunityMemberRecord['role'] | null> {
  const [row] = await db
    .select({ role: m.role })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .innerJoin(u, eq(u.id, m.userId))
    .where(
      and(eq(m.guildId, guildId), eq(m.userId, userId), liveInActiveHub()),
    );
  return row?.role ?? null;
}

/** Every live member's user id (the set form of `isMember`). */
export async function communityMemberUserIds(
  db: Db,
  guildId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: m.userId })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .innerJoin(u, eq(u.id, m.userId))
    .where(and(eq(m.guildId, guildId), liveInActiveHub()));
  return rows.map((r) => r.userId);
}

/** The active community hubs the user is a live member of. */
export async function memberCommunityHubIds(
  db: Db,
  userId: number,
): Promise<number[]> {
  const rows = await db
    .select({ guildId: m.guildId })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .innerJoin(u, eq(u.id, m.userId))
    .where(and(eq(m.userId, userId), liveInActiveHub()));
  return rows.map((r) => r.guildId);
}

/** Every row of the hub (live, left, banned) with the user's display fields. */
export async function loadCommunityMembers(
  db: Db,
  guildId: number,
): Promise<CommunityMemberRecord[]> {
  const rows = await db
    .select({
      memberId: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      bannedAt: m.bannedAt,
      username: u.username,
      displayName: u.displayName,
      avatar: u.customAvatarUrl,
      deactivatedAt: u.deactivatedAt,
    })
    .from(m)
    .innerJoin(u, eq(u.id, m.userId))
    .where(eq(m.guildId, guildId));
  return rows;
}

/** The viewer's A2 fields, or null when the user is gone. */
export async function loadDiscordFields(
  db: Db,
  userId: number,
): Promise<DiscordGuildMemberFields | null> {
  const [row] = await db
    .select({
      discordId: u.discordId,
      guildMemberSeenAt: u.guildMemberSeenAt,
      deactivatedAt: u.deactivatedAt,
    })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  return row ?? null;
}
