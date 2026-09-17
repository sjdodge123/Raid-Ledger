/**
 * Query, selection and copy helpers for the scheduling-poll expiry warning
 * (ROK-1604).
 *
 * Split out of `SchedulingPollExpiryService` so both files stay inside the
 * 300-line / 30-line caps. The pure functions here are the unit-test target;
 * the two candidate queries are covered by the integration spec.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sortSchedulingSlots } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { parseTimestampUtc } from '../../drizzle/timestamp-utils';
import { POLL_EXPIRY_WARN_HOURS } from '../lineup-notification.constants';
import {
  findScheduleSlots,
  findScheduleVotes,
} from './scheduling-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const HOUR_MS = 3_600_000;
/** Discord's hard cap on a button label. */
const LOCK_LABEL_MAX = 80;

/** An unlocked poll whose deadline is inside the warning window. */
export interface ExpiryWarnCandidate {
  lineupId: number;
  matchId: number;
  creatorId: number;
  gameName: string;
  phaseDeadline: Date;
}

/** The future slot a creator would lock in, per the shared slot order. */
export interface LeadingSlot {
  slotId: number;
  /** ISO-8601 UTC. */
  proposedTime: string;
  voteCount: number;
}

/** DM copy for the warning, plus the button label carried in the payload. */
export interface ExpiryWarnCopy {
  title: string;
  message: string;
  lockLabel: string;
}

/**
 * Unlocked scheduling polls whose `phase_deadline` falls in
 * `(now, now + POLL_EXPIRY_WARN_HOURS]`, with a live (non-deactivated)
 * creator. Same base shape as the vote nudge's `NUDGEABLE_POLLS_QUERY`.
 */
const EXPIRY_WARN_CANDIDATES_QUERY = sql`
  SELECT cl.id AS "lineupId",
         clm.id AS "matchId",
         cl.created_by AS "creatorId",
         COALESCE(g.name, 'your game') AS "gameName",
         cl.phase_deadline AS "phaseDeadline"
  FROM community_lineups cl
  JOIN community_lineup_matches clm ON clm.lineup_id = cl.id
  JOIN users u ON u.id = cl.created_by AND u.deactivated_at IS NULL
  LEFT JOIN games g ON g.id = clm.game_id
  WHERE cl.status = 'decided'
    AND clm.status = 'scheduling'
    AND cl.include_scheduling_phase IS NOT FALSE
    AND clm.linked_event_id IS NULL
    AND cl.created_by IS NOT NULL
    AND cl.phase_deadline > NOW()
    AND cl.phase_deadline <=
        NOW() + (${POLL_EXPIRY_WARN_HOURS}::int * INTERVAL '1 hour')
`;

/**
 * Unlocked polls that have ended and whose card still says otherwise, by
 * either route:
 *
 *  1. the deadline passed in the last 7 days, or the phase job archived the
 *     lineup (ROK-1604); or
 *  2. ROK-1607: every proposed time has passed — the last one inside the same
 *     7-day window. This is the only branch that reaches a poll with a NULL
 *     `phase_deadline`, which route 1 can never match.
 *
 * The 7-day floor bounds the scan on both routes; older polls predate this
 * sweep and stay as they are. Polls WITHOUT a card (e.g. private lineups) are
 * included on purpose: `syncEmbed` emits the `lineup:schedule-changed` nudge
 * before it looks for a card, and open poll pages rely on that nudge to show
 * the expired state (Codex P2, ROK-1604).
 */
const EXPIRED_EMBED_CANDIDATES_QUERY = sql`
  SELECT clm.id AS "matchId"
  FROM community_lineups cl
  JOIN community_lineup_matches clm ON clm.lineup_id = cl.id
  WHERE clm.status IN ('suggested', 'scheduling')
    AND clm.linked_event_id IS NULL
    AND (
      (
        (cl.phase_deadline <= NOW() OR cl.status = 'archived')
        AND cl.phase_deadline > NOW() - INTERVAL '7 days'
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM community_lineup_schedule_slots s
          WHERE s.match_id = clm.id AND s.proposed_time > NOW()
        )
        AND EXISTS (
          SELECT 1 FROM community_lineup_schedule_slots s
          WHERE s.match_id = clm.id
            AND s.proposed_time > NOW() - INTERVAL '7 days'
        )
      )
    )
`;

/**
 * Fetch the polls whose creator may be warned this tick.
 *
 * @param db - Drizzle database handle
 * @returns One row per candidate match
 */
export async function findExpiryWarnCandidates(
  db: Db,
): Promise<ExpiryWarnCandidate[]> {
  const rows = (await db.execute(
    EXPIRY_WARN_CANDIDATES_QUERY,
  )) as unknown as Array<
    Omit<ExpiryWarnCandidate, 'phaseDeadline'> & {
      phaseDeadline: Date | string;
    }
  >;
  return rows.map((r) => ({
    lineupId: r.lineupId,
    matchId: r.matchId,
    creatorId: r.creatorId,
    gameName: r.gameName,
    phaseDeadline: parseTimestampUtc(r.phaseDeadline),
  }));
}

/**
 * Fetch the match ids whose poll card should be re-rendered as expired.
 *
 * @param db - Drizzle database handle
 * @returns Match ids, one per expired unlocked poll with an embed
 */
export async function findExpiredEmbedMatchIds(db: Db): Promise<number[]> {
  const rows = (await db.execute(
    EXPIRED_EMBED_CANDIDATES_QUERY,
  )) as unknown as Array<{ matchId: number }>;
  return rows.map((r) => r.matchId);
}

/**
 * True when `deadline` is strictly after `now` and at most `hours` away.
 *
 * @param deadline - The poll's `phase_deadline`
 * @param now - Reference instant
 * @param hours - Window width in hours
 */
export function isInWarnWindow(
  deadline: Date,
  now: Date,
  hours: number,
): boolean {
  const delta = deadline.getTime() - now.getTime();
  return delta > 0 && delta <= hours * HOUR_MS;
}

/**
 * The leading slot among FUTURE slots that have at least one vote, ordered by
 * the shared `sortSchedulingSlots` rule (votes desc, earliest time, id).
 *
 * @param slots - Every slot of the match
 * @param votes - Every vote on those slots
 * @param now - Reference instant separating future from past slots
 * @returns The leader, or null when no future slot has a vote
 */
export function pickLeadingFutureSlot(
  slots: ReadonlyArray<{ id: number; proposedTime: Date }>,
  votes: ReadonlyArray<{ slotId: number }>,
  now: Date,
): LeadingSlot | null {
  const counts = new Map<number, number>();
  for (const v of votes) counts.set(v.slotId, (counts.get(v.slotId) ?? 0) + 1);
  const voted = slots
    .filter((s) => s.proposedTime.getTime() > now.getTime())
    .map((s) => ({ ...s, voteCount: counts.get(s.id) ?? 0 }))
    .filter((s) => s.voteCount > 0);
  const [leader] = sortSchedulingSlots(voted);
  if (!leader) return null;
  return {
    slotId: leader.id,
    proposedTime: leader.proposedTime.toISOString(),
    voteCount: leader.voteCount,
  };
}

/**
 * Load a match's slots + votes and pick the leading future slot.
 *
 * @param db - Drizzle database handle
 * @param matchId - The poll's match id
 * @param now - Reference instant (defaults to the wall clock)
 */
export async function findLeadingFutureSlot(
  db: Db,
  matchId: number,
  now: Date = new Date(),
): Promise<LeadingSlot | null> {
  const slots = await findScheduleSlots(db, matchId);
  const votes = await findScheduleVotes(
    db,
    slots.map((s) => s.id),
  );
  return pickLeadingFutureSlot(slots, votes, now);
}

/**
 * `Lock in <Ddd h:mm A>` in the community timezone, ≤80 chars. A corrupt
 * timezone falls back to UTC rather than aborting the sweep (mirrors
 * `formatEpoch`'s guard).
 *
 * @param iso - The leading slot's proposed time
 * @param timeZone - IANA timezone (community default)
 */
export function formatLockLabel(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  const d = new Date(iso);
  let when: string;
  try {
    when = d.toLocaleString('en-US', { ...opts, timeZone });
  } catch {
    when = d.toLocaleString('en-US', { ...opts, timeZone: 'UTC' });
  }
  return `Lock in ${when}`.slice(0, LOCK_LABEL_MAX);
}

/** Unix seconds for a Discord `<t:…>` token. */
function unix(value: Date | string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

/**
 * Title, message and button label for the creator's warning DM.
 *
 * @param gameName - The poll's game
 * @param deadline - The poll's `phase_deadline`
 * @param leadingIso - The leading slot's proposed time
 * @param timeZone - Community default timezone for the button label
 */
export function buildExpiryWarnCopy(
  gameName: string,
  deadline: Date,
  leadingIso: string,
  timeZone: string,
): ExpiryWarnCopy {
  return {
    title: `Your ${gameName} poll closes soon`,
    message:
      `Nobody has locked in a time and the poll closes <t:${unix(deadline)}:R>. ` +
      `The leading time is <t:${unix(leadingIso)}:f>.`,
    lockLabel: formatLockLabel(leadingIso, timeZone),
  };
}
