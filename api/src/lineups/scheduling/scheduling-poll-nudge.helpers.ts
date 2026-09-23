/**
 * Query + copy helpers for the recurring 24h scheduling-poll vote nudge.
 *
 * Split out of `SchedulingPollNudgeService` so both files stay well inside
 * the 300-line / 30-line caps.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { NotificationService } from '../../notifications/notification.service';
import type { NotificationDedupService } from '../../notifications/notification-dedup.service';
import {
  POLL_NUDGE_DEADLINE_HANDOFF_HOURS,
  POLL_NUDGE_MIN_MEMBER_AGE_HOURS,
  POLL_NUDGE_TTL_SECONDS,
} from '../lineup-notification.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** One scheduling poll that is eligible for the recurring nudge. */
export interface NudgePoll {
  lineupId: number;
  matchId: number;
  gameName: string;
  /** False when every proposed day has passed (the stalled-poll state). */
  hasFutureSlots: boolean;
  /** False when no day was ever proposed — distinct copy from "all passed". */
  hadSlots: boolean;
  /**
   * True when `phase_deadline` is within the 24h handoff window. The deadline
   * reminder services cover ZERO-vote members there, but their non-voter
   * query counts ANY vote ever — members whose only votes are on passed
   * slots are invisible to them, so the nudge keeps covering those.
   */
  inDeadlineHandoff: boolean;
}

interface NudgePollRow {
  lineupId: number;
  matchId: number;
  gameName: string;
  hasFutureSlots: boolean;
  hadSlots: boolean;
  inDeadlineHandoff: boolean;
}

/**
 * Active scheduling polls that the nudge may target. Mirrors `findActivePolls`
 * minus the deadline predicate and covers BOTH standalone and regular lineups.
 *
 * The parent-lineup `status = 'decided'` guard matters: deadline expiry
 * archives the lineup but leaves `match.status = 'scheduling'` forever.
 * `include_scheduling_phase` mirrors the poll page's 404 guard so a nudge
 * never deep-links to a dead page. Polls stay eligible until the deadline
 * actually passes; the final-24h handoff to the deadline DMs is per-member
 * (see `findPendingMemberIds`), not per-poll, because the deadline services
 * only cover zero-vote members.
 */
const nudgeablePollsQuery = (matchFilter: SQL): SQL => sql`
  SELECT cl.id AS "lineupId",
         clm.id AS "matchId",
         COALESCE(g.name, 'your game') AS "gameName",
         EXISTS (SELECT 1 FROM community_lineup_schedule_slots css
                 WHERE css.match_id = clm.id
                   AND css.proposed_time > NOW()) AS "hasFutureSlots",
         EXISTS (SELECT 1 FROM community_lineup_schedule_slots css2
                 WHERE css2.match_id = clm.id) AS "hadSlots",
         (cl.phase_deadline IS NOT NULL
          AND cl.phase_deadline <= NOW() +
              (${POLL_NUDGE_DEADLINE_HANDOFF_HOURS}::int * INTERVAL '1 hour'))
           AS "inDeadlineHandoff"
  FROM community_lineups cl
  JOIN community_lineup_matches clm ON clm.lineup_id = cl.id
  LEFT JOIN games g ON g.id = clm.game_id
  WHERE cl.status = 'decided'
    AND clm.status = 'scheduling'
    AND cl.include_scheduling_phase IS NOT FALSE
    AND (cl.phase_deadline IS NULL OR cl.phase_deadline > NOW())
    ${matchFilter}
`;

/** Normalise one raw row; `db.execute` hands booleans back untyped. */
function toNudgePoll(row: NudgePollRow): NudgePoll {
  return {
    lineupId: row.lineupId,
    matchId: row.matchId,
    gameName: row.gameName,
    hasFutureSlots: row.hasFutureSlots === true,
    hadSlots: row.hadSlots === true,
    inDeadlineHandoff: row.inDeadlineHandoff === true,
  };
}

/**
 * Fetch the polls eligible for nudging this tick.
 *
 * @param db - Drizzle database handle
 * @returns One row per eligible match, with its game name and slot state
 */
export async function findNudgeablePolls(db: Db): Promise<NudgePoll[]> {
  const rows = (await db.execute(
    nudgeablePollsQuery(sql``),
  )) as unknown as NudgePollRow[];
  return rows.map(toNudgePoll);
}

/**
 * The same eligibility check as {@link findNudgeablePolls}, narrowed to one
 * match — the organiser "Rally" nudge's entry point (ROK-1618, D6).
 *
 * Sharing the SQL is the point: the three copy variants key off
 * `hasFutureSlots` / `hadSlots`, which only this query computes, and a rally
 * that reached a poll the cron considers ineligible (cancelled lineup,
 * scheduling phase off, deadline passed) would deep-link to a dead page.
 *
 * @param db - Drizzle database handle
 * @param matchId - Match the organiser is rallying
 * @returns The poll, or `null` when it is not (or no longer) nudgeable
 */
export async function loadNudgePollById(
  db: Db,
  matchId: number,
): Promise<NudgePoll | null> {
  const rows = (await db.execute(
    nudgeablePollsQuery(sql`AND clm.id = ${matchId}`),
  )) as unknown as NudgePollRow[];
  return rows.length > 0 ? toNudgePoll(rows[0]) : null;
}

/**
 * Members of a match who are **pending**: no vote on any slot whose
 * `proposed_time` is still in the future.
 *
 * Votes are presence-only rows, so a member whose only votes sit on days
 * that have since passed re-enters this audience automatically — the
 * incident case. Deactivated users are filtered here (not just downstream)
 * so we never burn a 24h dedup key on someone who can't receive the DM.
 * Members younger than the grace period are held back so the poll's
 * creation-time DM owns the first 24 hours.
 *
 * With `staleVotersOnly` (the final-24h deadline handoff), the audience
 * narrows to members who HAVE votes — all necessarily stale here — because
 * zero-vote members already get the 24h/1h deadline DMs, while stale voters
 * are invisible to those services and would otherwise get nothing.
 *
 * @param db - Drizzle database handle
 * @param matchId - Match whose members are being classified
 * @param staleVotersOnly - Restrict to members with (stale) votes
 * @returns User ids that should receive the nudge this tick
 */
export async function findPendingMemberIds(
  db: Db,
  matchId: number,
  staleVotersOnly: boolean,
): Promise<number[]> {
  const staleGuard = staleVotersOnly
    ? sql`AND EXISTS (SELECT 1 FROM community_lineup_schedule_votes csv2
                      JOIN community_lineup_schedule_slots css3
                        ON css3.id = csv2.slot_id
                      WHERE css3.match_id = lmm.match_id
                        AND csv2.user_id = lmm.user_id)`
    : sql``;
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
      ${staleGuard}
  `)) as unknown as Array<{ userId: number }>;
  return rows.map((r) => r.userId);
}

/**
 * Title + message for the nudge DM. When no proposed day is still viable,
 * "vote on a time" would be misleading, so we ask for new times instead
 * (suggesting a slot auto-votes for it) — with distinct wording for a poll
 * whose days all passed vs one where no day was ever proposed.
 *
 * @param poll - Eligible poll with its game name and slot state
 * @returns Copy for `NotificationService.create`
 */
export function buildNudgeCopy(poll: NudgePoll): {
  title: string;
  message: string;
} {
  if (poll.hasFutureSlots) {
    return {
      title: 'Scheduling poll waiting on you',
      message:
        `The group still needs your availability for ${poll.gameName} — ` +
        'vote on a time so the poll can lock in.',
    };
  }
  if (!poll.hadSlots) {
    return {
      title: 'Scheduling poll needs times',
      message:
        `No days have been proposed for ${poll.gameName} yet — ` +
        'suggest a time so the group can pick one.',
    };
  }
  return {
    title: 'Scheduling poll needs new times',
    message:
      `All proposed days for ${poll.gameName} have passed — ` +
      'suggest a new time so the group can pick one.',
  };
}

/** Collaborators one poll-nudge DM needs. Structural, so the cron service and
 * the rally service can each pass their own injected instances. */
export interface PollNudgeDeps {
  notificationService: Pick<NotificationService, 'create'>;
  dedupService: Pick<NotificationDedupService, 'checkAndMarkSent'>;
}

/**
 * The 24h per-member dedup key for one recurring poll nudge.
 *
 * Owned by the cron alone. The organiser rally used to share it, but now
 * claims its own `sched-poll-rally:{matchId}:{slotId}:{userId}` on the 6h
 * rally TTL, so neither action can spend the other's budget.
 *
 * @param matchId - Match the nudge is about
 * @param userId - Recipient
 * @returns The dedup key, `sched-poll-nudge:{matchId}:{userId}`
 */
export function pollNudgeKey(matchId: number, userId: number): string {
  return `sched-poll-nudge:${matchId}:${userId}`;
}

/** Outcome of one attempted poll-nudge DM. */
export interface PollNudgeResult {
  /**
   * False when the shared 24h key was already marked for this (match, user).
   * True means this call owns the window — the key is burnt either way, which
   * is the cron's pre-existing behaviour.
   */
  dispatched: boolean;
  /** True only when a notification row was created (preferences allowed it). */
  created: boolean;
}

/**
 * Send one poll-nudge DM unless this (match, user) pair was already nudged
 * inside the current 24h window.
 *
 * The cron's send path only. The organiser "Rally" asks a different question
 * (does the LEADING time work?) with a different audience and its own 6h key,
 * so it has its own `sendRallyDm` in `scheduling-rally.helpers.ts`; keeping
 * that split is what lets the cron's 24h budget mean what it says.
 * Dispatch failures propagate and fail the poll for this tick.
 *
 * @param deps - Notification + dedup collaborators
 * @param poll - Eligible poll supplying the copy and the payload
 * @param userId - Recipient
 * @returns Whether the window was claimed and whether a row was created
 */
export async function sendPollNudge(
  deps: PollNudgeDeps,
  poll: NudgePoll,
  userId: number,
): Promise<PollNudgeResult> {
  const key = pollNudgeKey(poll.matchId, userId);
  const alreadySent = await deps.dedupService.checkAndMarkSent(
    key,
    POLL_NUDGE_TTL_SECONDS,
  );
  if (alreadySent) return { dispatched: false, created: false };

  const { title, message } = buildNudgeCopy(poll);
  const created = await deps.notificationService.create({
    userId,
    type: 'community_lineup',
    title,
    message,
    payload: {
      // Own 5-min rate-limit bucket, distinct from the deadline reminder.
      subtype: 'scheduling_poll_nudge',
      // Per-poll rate bucket: a user pending in N polls gets N DMs (each a
      // different deep link) instead of 1 DM + N-1 silently dropped — dedup
      // is marked pre-dispatch, so a dropped DM is lost for the whole window.
      reminderWindow: `poll-${poll.matchId}`,
      lineupId: poll.lineupId,
      matchId: poll.matchId,
      gameName: poll.gameName,
    },
  });
  return { dispatched: true, created: created !== null };
}
