/**
 * Target resolution queries for Community Lineup notifications (ROK-932).
 * Finds Discord-linked members and match members for DM dispatch.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { DiscordMember } from './lineup-notification-dm.helpers';

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
  `)) as unknown as DiscordMember[];
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
  return (await db.execute(sql`
    SELECT u.id, u.id AS "userId",
           COALESCE(u.display_name, u.username) AS "displayName",
           u.discord_id AS "discordId"
    FROM community_lineup_match_members lmm
    JOIN users u ON u.id = lmm.user_id
    WHERE lmm.match_id = ${matchId}
      AND u.discord_id IS NOT NULL
  `)) as unknown as DiscordMember[];
}
