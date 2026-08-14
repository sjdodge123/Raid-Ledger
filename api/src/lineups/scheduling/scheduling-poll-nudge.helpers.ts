/**
 * Query + copy helpers for the recurring 48h scheduling-poll vote nudge.
 *
 * Split out of `SchedulingPollNudgeService` so both files stay well inside
 * the 300-line / 30-line caps.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  POLL_NUDGE_DEADLINE_HANDOFF_HOURS,
  POLL_NUDGE_MIN_MEMBER_AGE_HOURS,
} from '../lineup-notification.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** One scheduling poll that is eligible for the recurring nudge. */
export interface NudgePoll {
  lineupId: number;
  matchId: number;
  gameName: string;
  /** False when every proposed day has passed (the stalled-poll state). */
  hasFutureSlots: boolean;
}

interface NudgePollRow {
  lineupId: number;
  matchId: number;
  gameName: string;
  hasFutureSlots: boolean;
}

/**
 * Active scheduling polls that the nudge may target.
 *
 * Mirrors `findActivePolls` minus the deadline predicate and covers BOTH
 * standalone and regular lineups. The parent-lineup `status = 'decided'`
 * guard matters: deadline expiry archives the lineup but leaves
 * `match.status = 'scheduling'` forever. `include_scheduling_phase` mirrors
 * the poll page's 404 guard so a nudge never deep-links to a dead page, and
 * the deadline predicate hands the final 24h (and any already-passed
 * deadline) to the ROK-1192 / LineupReminderService deadline DMs.
 *
 * @param db - Drizzle database handle
 * @returns One row per eligible match, with its game name and slot state
 */
export async function findNudgeablePolls(db: Db): Promise<NudgePoll[]> {
  const rows = (await db.execute(sql`
    SELECT cl.id AS "lineupId",
           clm.id AS "matchId",
           COALESCE(g.name, 'your game') AS "gameName",
           EXISTS (
             SELECT 1
             FROM community_lineup_schedule_slots css
             WHERE css.match_id = clm.id
               AND css.proposed_time > NOW()
           ) AS "hasFutureSlots"
    FROM community_lineups cl
    JOIN community_lineup_matches clm ON clm.lineup_id = cl.id
    LEFT JOIN games g ON g.id = clm.game_id
    WHERE cl.status = 'decided'
      AND clm.status = 'scheduling'
      AND cl.include_scheduling_phase IS NOT FALSE
      AND (
        cl.phase_deadline IS NULL
        OR cl.phase_deadline > NOW() +
           (${POLL_NUDGE_DEADLINE_HANDOFF_HOURS}::int * INTERVAL '1 hour')
      )
  `)) as unknown as NudgePollRow[];
  return rows.map((r) => ({
    lineupId: r.lineupId,
    matchId: r.matchId,
    gameName: r.gameName,
    hasFutureSlots: r.hasFutureSlots === true,
  }));
}

/**
 * Members of a match who are **pending**: no vote on any slot whose
 * `proposed_time` is still in the future.
 *
 * Votes are presence-only rows, so a member whose only votes sit on days
 * that have since passed re-enters this audience automatically — the
 * incident case. Deactivated users are filtered here (not just downstream)
 * so we never burn a 48h dedup key on someone who can't receive the DM.
 * Members younger than the grace period are held back so the poll's
 * creation-time DM owns the first 48 hours.
 *
 * @param db - Drizzle database handle
 * @param matchId - Match whose members are being classified
 * @returns User ids that should receive the nudge this tick
 */
export async function findPendingMemberIds(
  db: Db,
  matchId: number,
): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT lmm.user_id AS "userId"
    FROM community_lineup_match_members lmm
    JOIN users u ON u.id = lmm.user_id AND u.deactivated_at IS NULL
    WHERE lmm.match_id = ${matchId}
      AND lmm.created_at < NOW() -
          (${POLL_NUDGE_MIN_MEMBER_AGE_HOURS}::int * INTERVAL '1 hour')
      AND NOT EXISTS (
        SELECT 1
        FROM community_lineup_schedule_votes csv
        JOIN community_lineup_schedule_slots css ON css.id = csv.slot_id
        WHERE css.match_id = lmm.match_id
          AND csv.user_id = lmm.user_id
          AND css.proposed_time > NOW()
      )
  `)) as unknown as Array<{ userId: number }>;
  return rows.map((r) => r.userId);
}

/**
 * Title + message for the nudge DM. The stalled variant fires when every
 * proposed day has passed — "vote on a time" would be misleading, so we ask
 * for new times instead (suggesting a slot auto-votes for it).
 *
 * @param gameName - Game the poll is scheduling
 * @param hasFutureSlots - Whether any proposed day is still in the future
 * @returns Copy for `NotificationService.create`
 */
export function buildNudgeCopy(
  gameName: string,
  hasFutureSlots: boolean,
): { title: string; message: string } {
  if (!hasFutureSlots) {
    return {
      title: 'Scheduling poll needs new times',
      message:
        `All proposed days for ${gameName} have passed — ` +
        'suggest a new time so the group can pick one.',
    };
  }
  return {
    title: 'Scheduling poll waiting on you',
    message:
      `The group still needs your availability for ${gameName} — ` +
      'vote on a time so the poll can lock in.',
  };
}
