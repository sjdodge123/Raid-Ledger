/**
 * User deletion + moderation data-wipe helpers.
 * Extracted from users-query.helpers.ts for file size compliance (ROK-821).
 *
 * ROK-313 §9.6: `wipeUserData` removes EXACTLY what a full `deleteUser` removes,
 * minus the `users` row. Ban-with-wipe keeps the users row, so the ON DELETE
 * CASCADE FKs never fire — the wipe must delete every user-owned row explicitly.
 *
 * DRIFT GUARD (games-insert-paths style): every table with an FK to `users.id`
 * MUST be classified in exactly one bucket below (WIPE / REASSIGN / KEEP). A new
 * FK-to-users table added later without classification fails
 * `users-delete.helpers.drift.spec.ts`. Re-derive the source set with:
 *   grep -rn "references(() => users.id" api/src/drizzle/schema/
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { eq, or } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** A user-owned table deleted by a single `<column> = userId` predicate. */
export interface WipeTarget {
  table: PgTable;
  column: AnyPgColumn;
}

/**
 * WIPE bucket — user-owned rows deleted by `<column> = userId`.
 * First four are the pre-ROK-313 RESTRICT tables the delete path already wiped
 * explicitly (Phase A); the rest are the ON DELETE CASCADE tables that a hard
 * users-row delete would have cascaded (so an explicit delete here is
 * behavior-neutral for delete and load-bearing for ban+wipe).
 */
export const WIPE_BY_COLUMN: readonly WipeTarget[] = [
  { table: schema.sessions, column: schema.sessions.userId },
  { table: schema.localCredentials, column: schema.localCredentials.userId },
  { table: schema.availability, column: schema.availability.userId },
  { table: schema.eventTemplates, column: schema.eventTemplates.userId },
  { table: schema.refreshTokens, column: schema.refreshTokens.userId },
  { table: schema.characters, column: schema.characters.userId },
  { table: schema.eventSignups, column: schema.eventSignups.userId },
  { table: schema.notifications, column: schema.notifications.userId },
  {
    table: schema.userNotificationPreferences,
    column: schema.userNotificationPreferences.userId,
  },
  { table: schema.userPreferences, column: schema.userPreferences.userId },
  { table: schema.gameTimeTemplates, column: schema.gameTimeTemplates.userId },
  { table: schema.gameTimeOverrides, column: schema.gameTimeOverrides.userId },
  { table: schema.gameTimeAbsences, column: schema.gameTimeAbsences.userId },
  { table: schema.gameInterests, column: schema.gameInterests.userId },
  {
    table: schema.gameInterestSuppressions,
    column: schema.gameInterestSuppressions.userId,
  },
  { table: schema.feedback, column: schema.feedback.userId },
  {
    table: schema.wowClassicQuestProgress,
    column: schema.wowClassicQuestProgress.userId,
  },
  { table: schema.eventPlans, column: schema.eventPlans.creatorId },
  {
    table: schema.eventRemindersSent,
    column: schema.eventRemindersSent.userId,
  },
  {
    table: schema.gameActivitySessions,
    column: schema.gameActivitySessions.userId,
  },
  {
    table: schema.gameActivityRollups,
    column: schema.gameActivityRollups.userId,
  },
  {
    table: schema.playerTasteVectors,
    column: schema.playerTasteVectors.userId,
  },
  {
    table: schema.playerIntensitySnapshots,
    column: schema.playerIntensitySnapshots.userId,
  },
  {
    table: schema.communityLineupEntries,
    column: schema.communityLineupEntries.nominatedBy,
  },
  {
    table: schema.communityLineupVotes,
    column: schema.communityLineupVotes.userId,
  },
  {
    table: schema.communityLineupInvitees,
    column: schema.communityLineupInvitees.userId,
  },
  {
    table: schema.communityLineupMatchMembers,
    column: schema.communityLineupMatchMembers.userId,
  },
  {
    table: schema.communityLineupScheduleVotes,
    column: schema.communityLineupScheduleVotes.userId,
  },
  {
    table: schema.communityLineupTiebreakerBracketVotes,
    column: schema.communityLineupTiebreakerBracketVotes.userId,
  },
  {
    table: schema.communityLineupTiebreakerVetoes,
    column: schema.communityLineupTiebreakerVetoes.userId,
  },
  {
    table: schema.communityLineupUserSubmissions,
    column: schema.communityLineupUserSubmissions.userId,
  },
];

/**
 * WIPE bucket — special predicates.
 * `player_co_play` references two users (delete where either party matches);
 * `community_lineups.created_by` is a NOT NULL RESTRICT parent — deleting the
 * lineup cascades every entry/vote/match/tiebreaker/submission child (each
 * child→lineup FK is ON DELETE CASCADE).
 */
export const WIPE_SPECIAL_TABLES: readonly PgTable[] = [
  schema.playerCoPlay,
  schema.communityLineups,
];

/** REASSIGN bucket — user-authored shared entities transferred to the actor. */
export const REASSIGN_TABLES: readonly PgTable[] = [
  schema.pugSlots,
  schema.events,
];

/**
 * KEEP bucket — set-null FKs (the DB nulls them on a hard delete; on ban+wipe
 * the users row survives so they stay pointed at the still-existing banned user)
 * plus the `admin_actions` audit table itself (actorId/targetId set-null, §9.9).
 */
export const KEEP_TABLES: readonly PgTable[] = [
  schema.adminActions,
  schema.activityLog,
  schema.aiRequestLogs,
  schema.adHocParticipants,
  schema.eventVoiceSessions,
  schema.discoveryCategorySuggestions,
];

/** Delete every user-owned row (Phase A RESTRICT + all ON DELETE CASCADE). */
async function deleteUserOwnedData(tx: Db, userId: number): Promise<void> {
  for (const { table, column } of WIPE_BY_COLUMN) {
    await tx.delete(table).where(eq(column, userId));
  }
  await tx
    .delete(schema.playerCoPlay)
    .where(
      or(
        eq(schema.playerCoPlay.userIdA, userId),
        eq(schema.playerCoPlay.userIdB, userId),
      ),
    );
  // Deleting the lineup cascades all of its children (child→lineup FKs cascade).
  await tx
    .delete(schema.communityLineups)
    .where(eq(schema.communityLineups.createdBy, userId));
}

/** Reassign a user's PUG slots to another user (null the claim, move ownership). */
export async function reassignPugSlots(
  tx: Db,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await tx
    .update(schema.pugSlots)
    .set({ claimedByUserId: null })
    .where(eq(schema.pugSlots.claimedByUserId, userId));
  await tx
    .update(schema.pugSlots)
    .set({ createdBy: reassignToUserId })
    .where(eq(schema.pugSlots.createdBy, userId));
}

/** Reassign user-created entities (pug slots, events) to another user. */
async function reassignUserEntities(
  tx: Db,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await reassignPugSlots(tx, userId, reassignToUserId);
  await tx
    .update(schema.events)
    .set({ creatorId: reassignToUserId, updatedAt: new Date() })
    .where(eq(schema.events.creatorId, userId));
}

/**
 * TRUE data wipe (ROK-313 §9.6): delete every user-owned row + reassign authored
 * entities, KEEPING the users row. Must run inside the caller's transaction so a
 * mid-wipe failure rolls back (ban+wipe wraps this in `db.transaction`).
 */
export async function wipeUserData(
  tx: Db,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await deleteUserOwnedData(tx, userId);
  await reassignUserEntities(tx, userId, reassignToUserId);
}

/** Delete a user and cascade all related data in a transaction (ROK-405). */
export async function deleteUserTransaction(
  db: Db,
  userId: number,
  reassignToUserId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await wipeUserData(tx, userId, reassignToUserId);
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
