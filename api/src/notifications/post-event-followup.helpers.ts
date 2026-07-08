import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ACTIVE_MEMBER_SQL_AND } from '../users/users-active.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** A recently-ended event that qualifies for a post-event follow-up prompt. */
export type FollowupCandidateEvent = {
  id: number;
  title: string;
  creator_id: number;
  game_id: number | null;
};

/**
 * Resolve the recipients of a post-event quick-sign-up DM for an ended event
 * (ROK-1371 M1). Returns linked user IDs = everyone who had a signup row on the
 * event EXCEPT `declined` (i.e. signed_up, tentative, roached_out, departed),
 * minus the organizer, banned/kicked/deactivated users, users with no Discord
 * link, and users who opted out of `post_event_followup` Discord delivery.
 *
 * Anonymous signups (`user_id NULL`) are excluded by the `user_id IS NOT NULL`
 * predicate — we only DM users with an RL account + Discord link.
 *
 * @param db - Drizzle postgres-js database handle.
 * @param endedEventId - The just-ended event whose attendees to notify.
 * @param creatorId - The organizer, excluded from the attendee DM (HARD CONSTRAINT 8).
 * @returns Distinct user IDs to DM.
 */
export async function resolvePostEventFollowupRecipients(
  db: Db,
  endedEventId: number,
  creatorId: number,
): Promise<number[]> {
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT DISTINCT es.user_id
    FROM event_signups es
    JOIN users u ON u.id = es.user_id
    LEFT JOIN user_notification_preferences p ON p.user_id = u.id
    WHERE es.event_id = ${endedEventId}
      AND es.user_id IS NOT NULL
      AND es.user_id <> ${creatorId}
      AND es.status <> 'declined'
      AND u.discord_id IS NOT NULL
      ${sql.raw(ACTIVE_MEMBER_SQL_AND)}
      AND COALESCE(
        (p.channel_prefs #>> '{post_event_followup,discord}')::boolean,
        true
      ) = TRUE
  `);
  return Array.from(rows).map((r) => r.user_id);
}

/**
 * Find scheduled events whose EFFECTIVE end (`COALESCE(extended_until,
 * upper(duration))`) fell ~15 min ago and still need an organizer follow-up
 * prompt (ROK-1371 M2). Excludes cancelled, rescheduling, recurring, and ad-hoc
 * events, and any event already recorded in `post_event_followup_sent`.
 *
 * HARD CONSTRAINT 1: uses `COALESCE(extended_until, upper(duration))`, never raw
 * `upper(duration)` — an auto-extended, still-live event must not fire.
 *
 * @param db - Drizzle postgres-js database handle.
 * @returns Candidate events (id/title/creator_id/game_id).
 */
export async function findFollowupCandidateEvents(
  db: Db,
): Promise<FollowupCandidateEvent[]> {
  const rows = await db.execute<FollowupCandidateEvent>(sql`
    SELECT e.id, e.title, e.creator_id, e.game_id
    FROM events e
    WHERE COALESCE(e.extended_until, upper(e.duration))
            BETWEEN (now() - interval '16 minutes') AND (now() - interval '14 minutes')
      AND e.cancelled_at IS NULL
      AND e.rescheduling_poll_id IS NULL
      AND e.recurrence_group_id IS NULL
      AND e.is_ad_hoc = false
      AND e.id NOT IN (SELECT event_id FROM post_event_followup_sent)
  `);
  return Array.from(rows);
}
