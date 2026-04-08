/**
 * Drizzle query helpers for scheduling poll data (ROK-965).
 * Pure functions — no NestJS dependencies.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Shape of a schedule vote row with display name and avatar fields. */
export interface ScheduleVoteRow {
  id: number;
  slotId: number;
  userId: number;
  displayName: string;
  avatar: string | null;
  discordId: string | null;
  customAvatarUrl: string | null;
  createdAt: Date;
}

/** Find all schedule slots for a given match. */
export function findScheduleSlots(db: Db, matchId: number) {
  return db
    .select()
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
}

/** Find all votes for given slot IDs with user display names. */
export function findScheduleVotes(
  db: Db,
  slotIds: number[],
): Promise<ScheduleVoteRow[]> {
  if (slotIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: schema.communityLineupScheduleVotes.id,
      slotId: schema.communityLineupScheduleVotes.slotId,
      userId: schema.communityLineupScheduleVotes.userId,
      displayName:
        sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`.as(
          'display_name',
        ),
      avatar: schema.users.avatar,
      discordId: schema.users.discordId,
      customAvatarUrl: schema.users.customAvatarUrl,
      createdAt: schema.communityLineupScheduleVotes.createdAt,
    })
    .from(schema.communityLineupScheduleVotes)
    .innerJoin(
      schema.users,
      eq(schema.communityLineupScheduleVotes.userId, schema.users.id),
    )
    .where(inArray(schema.communityLineupScheduleVotes.slotId, slotIds));
}

/** Insert a new schedule slot. */
export function insertScheduleSlot(
  db: Db,
  matchId: number,
  proposedTime: Date,
  suggestedBy: 'system' | 'user',
) {
  return db
    .insert(schema.communityLineupScheduleSlots)
    .values({ matchId, proposedTime, suggestedBy })
    .returning();
}

/**
 * Insert a vote for a schedule slot (idempotent).
 * Uses ON CONFLICT DO NOTHING so concurrent inserts for the same
 * (slotId, userId) pair never throw a unique-constraint error.
 * Returns the inserted row when new, or an empty array when the vote
 * already existed.
 */
export function insertScheduleVote(db: Db, slotId: number, userId: number) {
  return db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId, userId })
    .onConflictDoNothing({
      target: [
        schema.communityLineupScheduleVotes.slotId,
        schema.communityLineupScheduleVotes.userId,
      ],
    })
    .returning();
}

/** Delete a vote for a schedule slot. */
export function deleteScheduleVote(db: Db, slotId: number, userId: number) {
  return db
    .delete(schema.communityLineupScheduleVotes)
    .where(
      and(
        eq(schema.communityLineupScheduleVotes.slotId, slotId),
        eq(schema.communityLineupScheduleVotes.userId, userId),
      ),
    );
}

/** Find a specific vote by slot and user. */
export function findVoteBySlotAndUser(db: Db, slotId: number, userId: number) {
  return db
    .select({ id: schema.communityLineupScheduleVotes.id })
    .from(schema.communityLineupScheduleVotes)
    .where(
      and(
        eq(schema.communityLineupScheduleVotes.slotId, slotId),
        eq(schema.communityLineupScheduleVotes.userId, userId),
      ),
    )
    .limit(1);
}

/** Update match status and linked event ID after event creation. */
export function updateMatchLinkedEvent(
  db: Db,
  matchId: number,
  eventId: number,
) {
  return db
    .update(schema.communityLineupMatches)
    .set({ status: 'scheduled', linkedEventId: eventId })
    .where(eq(schema.communityLineupMatches.id, matchId));
}

/** Delete all votes by a user on slots belonging to a given match. */
export function deleteAllUserVotesForMatch(
  db: Db,
  matchId: number,
  userId: number,
) {
  return db
    .delete(schema.communityLineupScheduleVotes)
    .where(
      and(
        eq(schema.communityLineupScheduleVotes.userId, userId),
        inArray(
          schema.communityLineupScheduleVotes.slotId,
          db
            .select({ id: schema.communityLineupScheduleSlots.id })
            .from(schema.communityLineupScheduleSlots)
            .where(eq(schema.communityLineupScheduleSlots.matchId, matchId)),
        ),
      ),
    );
}

/** Find matches in scheduling status for a lineup where a user is a member. */
export function findUserSchedulingMatches(
  db: Db,
  lineupId: number,
  userId: number,
) {
  return db
    .select({
      matchId: schema.communityLineupMatches.id,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      memberCount:
        sql<number>`(SELECT count(*)::int FROM community_lineup_match_members WHERE match_id = ${schema.communityLineupMatches.id})`.as(
          'member_count',
        ),
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupMatches.gameId, schema.games.id),
    )
    .innerJoin(
      schema.communityLineupMatchMembers,
      eq(
        schema.communityLineupMatches.id,
        schema.communityLineupMatchMembers.matchId,
      ),
    )
    .where(
      and(
        eq(schema.communityLineupMatches.lineupId, lineupId),
        eq(schema.communityLineupMatches.status, 'scheduling'),
        eq(schema.communityLineupMatchMembers.userId, userId),
      ),
    );
}
