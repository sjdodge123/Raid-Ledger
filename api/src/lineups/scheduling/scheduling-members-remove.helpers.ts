/**
 * Roster writes behind "remove a participant from a scheduling poll"
 * (ROK-2020), split out of `SchedulingMembersService` so the service stays
 * clear of the max-lines cap and its unit spec can mock the DB boundary.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { deleteAllUserVotesForMatch } from './scheduling-query.helpers';
import { lockMatchMember } from './scheduling-member-lock.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Rows a removal actually deleted. */
export interface RemovedMemberRows {
  removedVotes: number;
  removedMembers: number;
}

/**
 * Delete the user's membership row AND every stance they hold on this
 * match's slots, in ONE transaction — a half-applied removal would leave a
 * voter counted in the tally but missing from the roster (or the reverse).
 * Votes on other matches are untouched: the delete is scoped to this match's
 * slots by `deleteAllUserVotesForMatch`.
 *
 * Codex P2: the roster lock is taken FIRST, so a concurrent `toggleVote` for
 * the same user cannot insert a vote between the two deletes.
 */
export function deleteMatchMemberWithVotes(
  db: Db,
  matchId: number,
  userId: number,
): Promise<RemovedMemberRows> {
  return db.transaction(async (tx) => {
    await lockMatchMember(tx, matchId, userId);
    const votes = await deleteAllUserVotesForMatch(
      tx,
      matchId,
      userId,
    ).returning({ id: schema.communityLineupScheduleVotes.id });
    const members = await tx
      .delete(schema.communityLineupMatchMembers)
      .where(
        and(
          eq(schema.communityLineupMatchMembers.matchId, matchId),
          eq(schema.communityLineupMatchMembers.userId, userId),
        ),
      )
      .returning({ id: schema.communityLineupMatchMembers.id });
    return { removedVotes: votes.length, removedMembers: members.length };
  });
}

/** Roster size after a write — the poll's "N of M have voted" denominator. */
export async function countMatchMembers(
  db: Db,
  matchId: number,
): Promise<number> {
  const roster = await db
    .select({ id: schema.communityLineupMatchMembers.id })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  return roster.length;
}

/** Every slot's proposed time, for the poll-open check (ROK-1607 rule). */
export async function findSlotProposedTimes(
  db: Db,
  matchId: number,
): Promise<Date[]> {
  const rows = await db
    .select({ proposedTime: schema.communityLineupScheduleSlots.proposedTime })
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  return rows.map((r) => r.proposedTime);
}
