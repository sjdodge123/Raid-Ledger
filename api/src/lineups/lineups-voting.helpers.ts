/**
 * Voting helpers for community lineups (ROK-936).
 * Handles vote CRUD, toggle, and limit enforcement.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Default maximum votes a single user may cast per lineup. */
export const DEFAULT_MAX_VOTES = 3;

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
 * Uses a transaction to prevent race conditions on the vote limit.
 * @param maxVotes - per-lineup vote cap (from lineup.maxVotesPerPlayer).
 * @returns 'added' if the vote was cast, 'removed' if it was toggled off.
 */
export async function toggleVote(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number,
  maxVotes: number = DEFAULT_MAX_VOTES,
): Promise<'added' | 'removed'> {
  return db.transaction(async (tx) => {
    const existing = await findExistingVote(tx, lineupId, userId, gameId);
    if (existing) {
      await deleteVote(tx, existing.id);
      return 'removed';
    }
    const count = await countUserVotes(tx, lineupId, userId);
    if (count >= maxVotes) {
      throw new BadRequestException(
        `Maximum ${maxVotes} votes per lineup reached`,
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

/**
 * Insert a new vote row.
 * ROK-1474: `rank` stays null for a plain approval; `setStar` passes 1 so a
 * star on an unapproved game lands as ONE row in ONE statement rather than an
 * insert followed by an update another writer could interleave with.
 */
async function insertVote(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number,
  rank: number | null = null,
): Promise<void> {
  await db
    .insert(schema.communityLineupVotes)
    .values({ lineupId, userId, gameId, rank });
}

/**
 * ROK-1474: the ordinal a top pick is stored as. `1` is the star; `2..N` are
 * reserved for ranked choice and are never written today.
 */
export const TOP_PICK_RANK = 1;

/**
 * Find the game the user starred in a lineup, or null.
 * Separate from `findUserVotes` so the bare `number[]` that read returns —
 * pinned by existing callers and specs — stays exactly as it is.
 */
export async function findUserStar(
  db: Db,
  lineupId: number,
  userId: number | undefined,
): Promise<number | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ gameId: schema.communityLineupVotes.gameId })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
        eq(schema.communityLineupVotes.rank, TOP_PICK_RANK),
      ),
    )
    .limit(1);
  return row?.gameId ?? null;
}

/**
 * Count top picks per game for a lineup (ROK-1474).
 * Mirrors `countVotesPerGame`, narrowed to starred rows.
 */
export function countStarsPerGame(db: Db, lineupId: number) {
  return db
    .select({
      gameId: schema.communityLineupVotes.gameId,
      starCount: sql<number>`count(*)::int`.as('star_count'),
    })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.rank, TOP_PICK_RANK),
      ),
    )
    .groupBy(schema.communityLineupVotes.gameId);
}

/**
 * Set (or clear) the user's single top pick for a lineup (D2).
 *
 * Starring implies approval BY CONSTRUCTION, not by validation: the star is
 * `rank = 1` on the voter's own approval row, so there is no representable
 * state in which a star exists without its vote. Starring a game the voter
 * has not approved therefore inserts that approval, and the insert is
 * cap-checked exactly like a plain vote (Q2) — a star is not a way to exceed
 * `maxVotesPerPlayer`.
 *
 * The whole thing is one transaction so the "exactly one star" invariant is
 * never observable as broken, and so a cap rejection leaves the voter's
 * previous star intact rather than silently clearing it.
 *
 * @returns 'cleared' when gameId is null, 'set' otherwise.
 */
export async function setStar(
  db: Db,
  lineupId: number,
  userId: number,
  gameId: number | null,
  maxVotes: number = DEFAULT_MAX_VOTES,
): Promise<'set' | 'cleared'> {
  return db.transaction(async (tx) => {
    if (gameId === null) {
      await clearStarRank(tx, lineupId, userId);
      return 'cleared';
    }
    const existing = await findExistingVote(tx, lineupId, userId, gameId);
    if (!existing) {
      const count = await countUserVotes(tx, lineupId, userId);
      if (count >= maxVotes) {
        throw new BadRequestException(
          `Maximum ${maxVotes} votes per lineup reached`,
        );
      }
    }
    await clearStarRank(tx, lineupId, userId);
    if (existing) {
      await setVoteRank(tx, existing.id, TOP_PICK_RANK);
    } else {
      await insertVote(tx, lineupId, userId, gameId, TOP_PICK_RANK);
    }
    return 'set';
  });
}

/** Drop the user's current star, if any. Idempotent. */
async function clearStarRank(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<void> {
  await db
    .update(schema.communityLineupVotes)
    .set({ rank: null })
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
        eq(schema.communityLineupVotes.rank, TOP_PICK_RANK),
      ),
    );
}

/** Write an ordinal onto an existing vote row. */
async function setVoteRank(
  db: Db,
  voteId: number,
  rank: number,
): Promise<void> {
  await db
    .update(schema.communityLineupVotes)
    .set({ rank })
    .where(eq(schema.communityLineupVotes.id, voteId));
}
