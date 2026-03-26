/**
 * Match query helpers for community lineup decided view (ROK-937).
 * Provides database queries for match data retrieval.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Shape of a match member row with display name. */
export interface MatchMemberRow {
  id: number;
  matchId: number;
  userId: number;
  source: string;
  createdAt: Date;
  displayName: string;
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
    })
    .from(schema.communityLineupMatchMembers)
    .innerJoin(
      schema.users,
      eq(schema.communityLineupMatchMembers.userId, schema.users.id),
    )
    .where(inArray(schema.communityLineupMatchMembers.matchId, matchIds));
}

/** Find a single match by ID. */
export function findMatchById(db: Db, matchId: number) {
  return db
    .select()
    .from(schema.communityLineupMatches)
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
