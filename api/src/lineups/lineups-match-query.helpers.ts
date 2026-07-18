/**
 * Match query helpers for community lineup decided view (ROK-937).
 * Provides database queries for match data retrieval.
 */
import { and, eq, inArray, sql, getTableColumns } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Shape of a match member row with display name and avatar info. */
export interface MatchMemberRow {
  id: number;
  matchId: number;
  userId: number;
  source: string;
  createdAt: Date;
  displayName: string;
  avatar: string | null;
  discordId: string | null;
  customAvatarUrl: string | null;
  /** ROK-1296: scheduling submission timestamp (null = not submitted). */
  schedulingSubmittedAt: Date | null;
}

/** Find all matches for a given lineup with game info. */
export function findMatchesByLineup(db: Db, lineupId: number) {
  return db
    .select({
      id: schema.communityLineupMatches.id,
      lineupId: schema.communityLineupMatches.lineupId,
      gameId: schema.communityLineupMatches.gameId,
      status: schema.communityLineupMatches.status,
      thresholdMet: schema.communityLineupMatches.thresholdMet,
      voteCount: schema.communityLineupMatches.voteCount,
      votePercentage: schema.communityLineupMatches.votePercentage,
      fitType: schema.communityLineupMatches.fitType,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
      createdAt: schema.communityLineupMatches.createdAt,
      updatedAt: schema.communityLineupMatches.updatedAt,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      // ROK-1411: max player count drives the "X of Y players" denominator.
      gamePlayerCount: schema.games.playerCount,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupMatches.gameId, schema.games.id),
    )
    .where(eq(schema.communityLineupMatches.lineupId, lineupId));
}

/** Find all members for given match IDs with display names. */
export function findMatchMembers(
  db: Db,
  matchIds: number[],
): Promise<MatchMemberRow[]> {
  if (matchIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: schema.communityLineupMatchMembers.id,
      matchId: schema.communityLineupMatchMembers.matchId,
      userId: schema.communityLineupMatchMembers.userId,
      source: schema.communityLineupMatchMembers.source,
      createdAt: schema.communityLineupMatchMembers.createdAt,
      displayName:
        sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`.as(
          'display_name',
        ),
      avatar: schema.users.avatar,
      discordId: schema.users.discordId,
      customAvatarUrl: schema.users.customAvatarUrl,
      schedulingSubmittedAt:
        schema.communityLineupMatchMembers.schedulingSubmittedAt,
    })
    .from(schema.communityLineupMatchMembers)
    .innerJoin(
      schema.users,
      eq(schema.communityLineupMatchMembers.userId, schema.users.id),
    )
    .where(inArray(schema.communityLineupMatchMembers.matchId, matchIds));
}

/**
 * Find a single match by ID, with the parent lineup's scheduling opt-out flag
 * joined in (ROK-1302) so callers can gate scheduling mutations without a
 * second query. The flat shape preserves every match column for existing
 * callers and adds `includeSchedulingPhase`.
 */
export function findMatchById(db: Db, matchId: number) {
  return db
    .select({
      ...getTableColumns(schema.communityLineupMatches),
      includeSchedulingPhase: schema.communityLineups.includeSchedulingPhase,
    })
    .from(schema.communityLineupMatches)
    .leftJoin(
      schema.communityLineups,
      eq(schema.communityLineupMatches.lineupId, schema.communityLineups.id),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
}

/** Check if a user is already a member of a match. */
export function findExistingMatchMember(
  db: Db,
  matchId: number,
  userId: number,
) {
  return db
    .select({ id: schema.communityLineupMatchMembers.id })
    .from(schema.communityLineupMatchMembers)
    .where(
      and(
        eq(schema.communityLineupMatchMembers.matchId, matchId),
        eq(schema.communityLineupMatchMembers.userId, userId),
      ),
    )
    .limit(1);
}

/** Count members in a match. */
export function countMatchMembers(db: Db, matchId: number) {
  return db
    .select({
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
}
