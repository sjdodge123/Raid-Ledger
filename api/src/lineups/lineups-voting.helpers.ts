/**
 * Voting helpers for community lineups (ROK-936).
 * Handles vote CRUD, toggle, and limit enforcement.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Maximum votes a single user may cast per lineup. */
export const MAX_VOTES = 3;

/**
 * Find the game IDs a user has voted for in a lineup.
 * Returns an empty array if the user has cast no votes.
 */
export async function findUserVotes(
  db: Db,
  lineupId: number,
  userId: number | undefined,
): Promise<number[]> {
  if (!userId) return [];
  const rows = await db
    .select({ gameId: schema.communityLineupVotes.gameId })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
      ),
    );
  return rows.map((r) => r.gameId);
}

/**
 * Count how many votes a user has cast in a lineup.
 */
export async function countUserVotes(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Toggle a vote for a game in a lineup.
 * Uses a transaction to prevent race conditions on the 3-vote limit.
 * @returns 'added' if the vote was cast, 'removed' if it was toggled off.
 */
export async function toggleVote(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number,
): Promise<'added' | 'removed'> {
  return db.transaction(async (tx) => {
    const existing = await findExistingVote(tx, lineupId, userId, gameId);
    if (existing) {
      await deleteVote(tx, existing.id);
      return 'removed';
    }
    const count = await countUserVotes(tx, lineupId, userId);
    if (count >= MAX_VOTES) {
      throw new BadRequestException(
        `Maximum ${MAX_VOTES} votes per lineup reached`,
      );
    }
    await insertVote(tx, lineupId, userId, gameId);
    return 'added';
  });
}

/** Find a specific vote row for deduplication check. */
async function findExistingVote(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number,
) {
  const [row] = await db
    .select({ id: schema.communityLineupVotes.id })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
        eq(schema.communityLineupVotes.gameId, gameId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Delete a single vote row by ID. */
async function deleteVote(db: Db, voteId: number): Promise<void> {
  await db
    .delete(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.id, voteId));
}

/** Insert a new vote row. */
async function insertVote(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number,
): Promise<void> {
  await db
    .insert(schema.communityLineupVotes)
    .values({ lineupId, userId, gameId });
}
