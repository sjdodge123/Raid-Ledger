/**
 * Server-side ownership of `community_lineup_match_members.scheduling_submitted_at`
 * (ROK-1544).
 *
 * The member-facing Submit step is retired: tapping a slot IS the whole action
 * (approval voting, one vote per slot, any number of slots). The column that
 * used to be written by `POST /lineups/:id/matches/:matchId/submit-scheduling`
 * keeps its exact meaning — "this member has told us when they can play" — but
 * is now derived from the votes themselves:
 *
 *   - first vote on the match  → stamp `now()`
 *   - later votes              → stamp is left alone (it marks the FIRST answer)
 *   - last vote withdrawn      → cleared back to NULL
 *
 * Everything that reads the column is unchanged: quorum, `SchedulingVoteProgress`,
 * the reminder cron's non-voter query (`lineup-reminder-target.helpers.ts`), the
 * poll-nudge audience, and the web hero's `waiting` tone.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Reconcile one member's `scheduling_submitted_at` with their current votes.
 *
 * Idempotent and safe to call after every vote write — `COALESCE` keeps the
 * original stamp so a second vote never re-stamps, and a member row that does
 * not exist (a rejected vote never enrolls anyone) is simply not matched.
 *
 * @param db Drizzle handle or transaction.
 * @param matchId Match whose slots the votes belong to.
 * @param userId Member whose stamp is being reconciled.
 */
export async function syncSchedulingSubmittedAt(
  db: Db,
  matchId: number,
  userId: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE community_lineup_match_members m
    SET scheduling_submitted_at = CASE
      WHEN EXISTS (
        SELECT 1
        FROM community_lineup_schedule_votes v
        JOIN community_lineup_schedule_slots s ON s.id = v.slot_id
        WHERE s.match_id = ${matchId} AND v.user_id = ${userId}
      )
      THEN COALESCE(m.scheduling_submitted_at, now())
      ELSE NULL
    END
    WHERE m.match_id = ${matchId} AND m.user_id = ${userId}
  `);
}
