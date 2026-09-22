/**
 * Query, dedup keys and copy for the "everyone picked this time" creator DM
 * (ROK-1632 AC3).
 *
 * Pure module: no NestJS, no DI, so every branch is unit-testable without a
 * module (the `scheduling-vote-write.helpers.ts` precedent). The service that
 * consumes these lives in `scheduling-unanimous.service.ts`.
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { parseTimestampUtc } from '../../drizzle/timestamp-utils';
import type { CreateNotificationInput } from '../../notifications/notification.types';
import { formatLockLabel } from './scheduling-poll-expiry.helpers';

/**
 * Payload discriminator. Reuses the existing `community_lineup`
 * `NotificationType`, so channel prefs, the prefs UI and the web notification
 * router need no change (spec D5).
 */
export const UNANIMOUS_SUBTYPE = 'scheduling_poll_unanimous_time';

/** One slot that every match member said yes to. */
export interface UnanimousSlotRow {
  matchId: number;
  slotId: number;
  lineupId: number;
  creatorId: number;
  gameName: string;
  /** ISO-8601 with a `Z` suffix — see the `to_char` cast in the query. */
  proposedTime: string;
  /** Every one of them voted yes — used in the copy. */
  memberCount: number;
}

/**
 * Strict 100% (spec D4): no member of the match is missing a `yes` on this
 * slot. Deliberately NOT `COUNT(yes) >= COUNT(members)` — a non-member can
 * vote before `ensureMatchMember` runs on some paths, which would let a count
 * comparison pass while a real member abstains.
 */
const EVERY_MEMBER_SAID_YES = sql`
  NOT EXISTS (
    SELECT 1 FROM community_lineup_match_members mm
    WHERE mm.match_id = m.id
      AND NOT EXISTS (
        SELECT 1 FROM community_lineup_schedule_votes v
        WHERE v.slot_id = s.id AND v.user_id = mm.user_id AND v.stance = 'yes'
      )
  )`;

/**
 * Every future slot of a live poll that every one of its members said yes to.
 *
 * "Live" is gated at BOTH levels: the lineup-phase job archives the LINEUP and
 * leaves the match on `scheduling` (see `assertPollOpen`,
 * `scheduling-guard.helpers.ts`), so `m.status` alone would let a poll the UI
 * calls expired still DM "Lock it in". A NULL `phase_deadline` (standalone
 * polls have none) must still pass, and an already locked-in match
 * (`linked_event_id`) has nothing left to announce.
 *
 * Rows are ordered earliest-time-first so the service's one-DM-per-match cap
 * always picks the same slot.
 *
 * `proposed_time` is a zone-LESS `timestamp` holding UTC, so it is cast with
 * an explicit `Z` rather than handed over naive — a bare value is parsed as
 * LOCAL time on a non-UTC host.
 *
 * @param matchId - Scope to one poll (the inline hook), or `null` to scan
 *   every poll (the cron safety net).
 * @returns The drizzle `sql` template to hand to `db.execute`.
 */
export function UNANIMOUS_SLOTS_QUERY(matchId: number | null): SQL {
  const scope = matchId === null ? sql`` : sql` AND m.id = ${matchId}`;
  return sql`
    SELECT m.id AS "matchId", s.id AS "slotId", m.lineup_id AS "lineupId",
           l.created_by AS "creatorId", g.name AS "gameName",
           to_char(s.proposed_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "proposedTime",
           mem.n::int AS "memberCount"
    FROM community_lineup_schedule_slots s
    JOIN community_lineup_matches m ON m.id = s.match_id
    JOIN community_lineups l ON l.id = m.lineup_id
    JOIN games g ON g.id = m.game_id
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS n FROM community_lineup_match_members mm
      WHERE mm.match_id = m.id
    ) mem
    WHERE m.status = 'scheduling'
      AND l.status <> 'archived'
      AND (l.phase_deadline IS NULL OR l.phase_deadline > NOW())
      AND m.linked_event_id IS NULL
      AND s.proposed_time > NOW()
      AND mem.n > 1
      AND ${EVERY_MEMBER_SAID_YES}${scope}
    ORDER BY s.proposed_time ASC, s.id ASC`;
}

/**
 * The permanent "already announced" claim — once per poll per time, exactly
 * the AC's words. Follows `warnDedupKey`.
 *
 * @param matchId - The poll's match id
 * @param slotId - The unanimous slot
 * @returns The `notification_dedup` key
 */
export function unanimousDedupKey(matchId: number, slotId: number): string {
  return `sched-poll-unanimous:${matchId}:${slotId}`;
}

/**
 * The Discord rate-limit bucket for this DM. Distinct from the cron nudge's
 * `poll-{id}` and the rally's `rally-{id}`, or this DM would be swallowed by
 * an unrelated 5-minute bucket.
 *
 * @param matchId - The poll's match id
 * @param slotId - The unanimous slot
 * @returns The `reminderWindow` bucket key
 */
export function unanimousReminderWindow(
  matchId: number,
  slotId: number,
): string {
  return `unanimous-${matchId}-${slotId}`;
}

/** Unix seconds for a Discord `<t:…>` token, read as UTC. */
function unix(value: string): number {
  return Math.floor(parseTimestampUtc(value).getTime() / 1000);
}

/**
 * Title and message for the creator's "everyone's in" DM.
 *
 * `<t:…:f>` renders in the recipient's own timezone in Discord AND in the web
 * notification list (`NotificationItem` pipes both strings through
 * `renderDiscordTimestamps`), so one string serves both surfaces.
 *
 * A one-member match never reaches this copy — the query's `mem.n > 1` floor
 * excludes it, because a solo poll's suggester auto-votes yes and the creator
 * would be DM'ing themselves (Lead override of spec OQ-A).
 *
 * @param gameName - The poll's game
 * @param memberCount - Members of the match, all of whom said yes
 * @param proposedTimeIso - The unanimous slot's time
 * @returns Title + message, shared by the DM and the in-app row
 */
export function buildUnanimousCopy(
  gameName: string,
  memberCount: number,
  proposedTimeIso: string,
): { title: string; message: string } {
  return {
    title: `Everyone's in for ${gameName}`,
    message:
      `All ${memberCount} members said yes to ` +
      `<t:${unix(proposedTimeIso)}:f>. Lock it in.`,
  };
}

/**
 * The full `NotificationService.create` input for one unanimous slot.
 *
 * `slotId` + `lockLabel` are what widen the Discord button from "Vote on a
 * Time" to a one-click Lock link (spec D3).
 *
 * @param row - One row of `UNANIMOUS_SLOTS_QUERY`
 * @param timeZone - Community default timezone, for the button label
 * @returns Input for `NotificationService.create`
 */
export function buildUnanimousNotification(
  row: UnanimousSlotRow,
  timeZone: string,
): CreateNotificationInput {
  const { title, message } = buildUnanimousCopy(
    row.gameName,
    row.memberCount,
    row.proposedTime,
  );
  return {
    userId: row.creatorId,
    type: 'community_lineup',
    title,
    message,
    payload: {
      subtype: UNANIMOUS_SUBTYPE,
      reminderWindow: unanimousReminderWindow(row.matchId, row.slotId),
      lineupId: row.lineupId,
      matchId: row.matchId,
      slotId: row.slotId,
      lockLabel: formatLockLabel(row.proposedTime, timeZone),
      gameName: row.gameName,
    },
  };
}
