import { BadRequestException } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
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
      playerCount: schema.games.playerCount,
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
/** Forward transitions (auto-advance / force-advance). */
export const VALID_TRANSITIONS: Record<LineupStatus, LineupStatus | null> = {
  building: 'voting',
  voting: 'decided',
  decided: 'archived',
  archived: null,
};

/** Reverse transitions (operator revert). */
export const VALID_REVERSIONS: Record<LineupStatus, LineupStatus | null> = {
  building: null,
  voting: 'building',
  decided: 'voting',
  archived: 'decided',
};

/** Count entries in a lineup (for cap enforcement). */
export function countLineupEntries(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select({
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
}

/** Count distinct nominators in a lineup (for dynamic cap). */
export function countDistinctNominators(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
) {
  return db
    .select({
      count:
        sql<number>`count(distinct ${schema.communityLineupEntries.nominatedBy})::int`.as(
          'count',
        ),
    })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
}

/** Get game IDs already nominated in a lineup. */
export async function findNominatedGameIds(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ gameId: schema.communityLineupEntries.gameId })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return rows.map((r) => r.gameId);
}

/** Get game id + name for all entries in a lineup. */
export async function findNominatedGames(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.communityLineupEntries)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupEntries.gameId, schema.games.id),
    )
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
}

/** Validate the decided game exists in the lineup entries. */
export async function validateDecidedGame(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
  gameId: number,
) {
  const entries = await db
    .select({ gameId: schema.communityLineupEntries.gameId })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  if (!entries.some((e) => e.gameId === gameId)) {
    throw new BadRequestException('Game must be in lineup entries');
  }
}

/** Find an active lineup specifically in building status. */
export function findBuildingLineup(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.status, 'building'))
    .orderBy(desc(schema.communityLineups.createdAt))
    .limit(1);
}

/**
 * Distinct union of users whose taste should inform Common Ground scoring
 * for a lineup (ROK-950). Combines:
 *   - vote casters on the lineup
 *   - nominators of games in the lineup
 *   - the lineup creator
 *   - any community member who has a stored taste vector (so nascent
 *     lineups with zero votes still benefit from known taste signals)
 *
 * Returning a broader set is intentional: during the `building` phase the
 * scoring helper gets called before any votes exist, and the spec tests
 * require the taste factor to still reflect known community taste.
 */
export async function findLineupVoterIds(
  db: PostgresJsDatabase<typeof schema>,
  lineupId: number,
): Promise<number[]> {
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM community_lineup_votes WHERE lineup_id = ${lineupId}
      UNION
      SELECT nominated_by AS user_id
        FROM community_lineup_entries WHERE lineup_id = ${lineupId}
      UNION
      SELECT created_by AS user_id
        FROM community_lineups WHERE id = ${lineupId}
      UNION
      SELECT user_id FROM player_taste_vectors
    ) AS voters
  `);
  return rows.map((r) => r.user_id);
}

/**
 * Resolve the distinct co-play partner IDs for a group of users (ROK-950).
 * Returns the set of user IDs that have co-played with ANY of the inputs,
 * excluding the inputs themselves.
 */
export async function findCoPlayPartnerIds(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const idList = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT DISTINCT partner_id AS user_id FROM (
      SELECT user_id_b AS partner_id FROM player_co_play WHERE user_id_a IN (${idList})
      UNION
      SELECT user_id_a AS partner_id FROM player_co_play WHERE user_id_b IN (${idList})
    ) p
    WHERE partner_id NOT IN (${idList})
  `);
  return new Set(rows.map((r) => r.user_id));
}
