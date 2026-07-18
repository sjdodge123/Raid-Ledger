/**
 * Target resolution queries for Community Lineup notifications (ROK-932).
 * Finds Discord-linked members and match members for DM dispatch.
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { DiscordMember } from './lineup-notification-dm.helpers';
import { activeUsersFilter } from '../users/users-active.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Get all community members with Discord linked. */
export async function findDiscordLinkedMembers(
  db: Db,
): Promise<DiscordMember[]> {
  return (await db.execute(sql`
    SELECT u.id, u.id AS "userId",
           COALESCE(u.display_name, u.username) AS "displayName",
           u.discord_id AS "discordId"
    FROM users u
    WHERE u.discord_id IS NOT NULL
      AND u.deactivated_at IS NULL
  `)) as unknown as DiscordMember[];
}

/**
 * Get Discord-linked invitees + creator for a private lineup (ROK-1065).
 * The distinct union guarantees the creator is always included even if they
 * haven't been explicitly invited.
 */
export async function findInviteeDiscordMembers(
  db: Db,
  lineupId: number,
): Promise<DiscordMember[]> {
  // ROK-1131: typed rewrite of the raw SQL. Semantics preserved exactly:
  // DISTINCT over the invitee ∪ creator union — the creator is ALWAYS included
  // even when not explicitly invited. `inArray` on the single-row creator
  // subquery matches the old `u.id = (SELECT created_by …)` for both the
  // found and no-row cases.
  const inviteeIds = db
    .select({ userId: schema.communityLineupInvitees.userId })
    .from(schema.communityLineupInvitees)
    .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
  const creatorId = db
    .select({ createdBy: schema.communityLineups.createdBy })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId));
  const rows = await db
    .selectDistinct({
      id: schema.users.id,
      userId: schema.users.id,
      displayName: sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`,
      discordId: schema.users.discordId,
    })
    .from(schema.users)
    .where(
      and(
        isNotNull(schema.users.discordId),
        activeUsersFilter(),
        or(
          inArray(schema.users.id, inviteeIds),
          inArray(schema.users.id, creatorId),
        ),
      ),
    );
  return rows as DiscordMember[];
}

/** Check if a match already has a poll embed posted (ROK-1033). */
export async function hasExistingPollEmbed(
  db: Db,
  matchId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ embedMessageId: schema.communityLineupMatches.embedMessageId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return !!row?.embedMessageId;
}

/** Get match members with Discord linked. */
export async function findMatchMemberUsers(
  db: Db,
  matchId: number,
): Promise<DiscordMember[]> {
  // ROK-1131: typed rewrite of the raw SQL — same inner join + filters.
  const rows = await db
    .select({
      id: schema.users.id,
      userId: schema.users.id,
      displayName: sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`,
      discordId: schema.users.discordId,
    })
    .from(schema.communityLineupMatchMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.communityLineupMatchMembers.userId),
    )
    .where(
      and(
        eq(schema.communityLineupMatchMembers.matchId, matchId),
        isNotNull(schema.users.discordId),
        activeUsersFilter(),
      ),
    );
  return rows as DiscordMember[];
}

/**
 * Resolve a list of user IDs into Discord-linked member rows (ROK-1117).
 *
 * Adapter for `loadExpectedVoters` (which returns bare user IDs) so we can
 * feed the same DM-fan-out helpers everything else uses. Filters out users
 * that have no `discord_id`, because they cannot receive a Discord DM.
 */
export async function findDiscordMembersByUserIds(
  db: Db,
  userIds: ReadonlyArray<number>,
): Promise<DiscordMember[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.users.id,
      userId: schema.users.id,
      displayName: sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`,
      discordId: schema.users.discordId,
    })
    .from(schema.users)
    .where(
      and(
        isNotNull(schema.users.discordId),
        inArray(schema.users.id, [...userIds]),
        activeUsersFilter(),
      ),
    );
  return rows as DiscordMember[];
}
