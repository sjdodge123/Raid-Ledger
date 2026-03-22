import { eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';

const ACTIVE_STATUSES: LineupStatus[] = ['building', 'voting'];

/** Find any lineup in building or voting status. */
export function findActiveLineup(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(inArray(schema.communityLineups.status, ACTIVE_STATUSES))
    .limit(1);
}

/** Load full lineup row by ID. */
export function findLineupById(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
}

/** Load entries with game + nominator info for a lineup. */
export function findEntriesWithGames(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select({
      id: schema.communityLineupEntries.id,
      gameId: schema.communityLineupEntries.gameId,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      nominatedById: schema.communityLineupEntries.nominatedBy,
      nominatedByName:
        sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`.as(
          'nominated_by_name',
        ),
      note: schema.communityLineupEntries.note,
      carriedOverFrom: schema.communityLineupEntries.carriedOverFrom,
      createdAt: schema.communityLineupEntries.createdAt,
    })
    .from(schema.communityLineupEntries)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupEntries.gameId, schema.games.id),
    )
    .innerJoin(
      schema.users,
      eq(schema.communityLineupEntries.nominatedBy, schema.users.id),
    )
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
}

/** Count votes per game for a lineup. */
export function countVotesPerGame(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select({
      gameId: schema.communityLineupVotes.gameId,
      voteCount: sql<number>`count(*)::int`.as('vote_count'),
    })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId))
    .groupBy(schema.communityLineupVotes.gameId);
}

/** Count distinct voters for a lineup. */
export function countDistinctVoters(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select({
      total:
        sql<number>`count(distinct ${schema.communityLineupVotes.userId})::int`.as(
          'total',
        ),
    })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId));
}

/** Lookup a user's display identity. */
export function findUserById(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
) {
  return db
    .select({
      id: schema.users.id,
      displayName:
        sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`.as(
          'display_name',
        ),
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
}

/** Lookup a game name by ID. */
export function findGameName(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
) {
  return db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
}

/** Valid status transitions: current → allowed next. */
export const VALID_TRANSITIONS: Record<LineupStatus, LineupStatus | null> = {
  building: 'voting',
  voting: 'decided',
  decided: 'archived',
  archived: null,
};
