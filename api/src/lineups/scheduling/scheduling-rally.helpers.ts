/**
 * Query, copy and dispatch helpers for the organiser "Rally" nudge (ROK-1618).
 *
 * The rally asks ONE question: "does the leading time work for you?". Its
 * audience is therefore everybody with no stance — yes or no — on the LEADING
 * slot, which is deliberately NOT the recurring cron nudge's audience (members
 * with no stance on ANY future slot). A poll at 3 of 4 YES on the leading time
 * has exactly one person left to chase even when that person voted on some
 * other day, and the first shipped version reported "everyone has voted".
 *
 * Consequences of owning the question:
 *   - own per-member dedup key (`sched-poll-rally:{match}:{slot}:{user}`) on
 *     the 6h rally TTL, so a rally never spends the cron's 24h budget and a
 *     NEW leading slot is always rally-able;
 *   - own copy, naming the leading time as a Discord `<t:…:f>` token;
 *   - no member-age floor — a rally is a deliberate human action, and a member
 *     added an hour ago is exactly who the organiser wants to reach.
 *
 * The per-poll cooldown (`rallyCooldownKey`) still stops an organiser pressing
 * the button repeatedly; it is a `NotificationDedupService` key rather than a
 * column — no migration, same mechanism as the manual "Remind voters" gate.
 *
 * The success copy (`summariseRally`) lives in `@raid-ledger/contract` instead,
 * because the web toast reads the same table.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { NotificationService } from '../../notifications/notification.service';
import type { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { POLL_RALLY_COOLDOWN_SECONDS } from '../lineup-notification.constants';
import type { LeadingSlot } from './scheduling-poll-expiry.helpers';
import type { NudgePoll } from './scheduling-poll-nudge.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Prefix for the per-poll rally cooldown key. */
const RALLY_COOLDOWN_PREFIX = 'sched-poll-rally-cooldown';

/** Prefix for the rally's OWN per-member key. Distinct from both the cron's
 * `sched-poll-nudge:…` and from {@link RALLY_COOLDOWN_PREFIX}, which is a
 * longer string — the two never resolve to the same key. */
const RALLY_MEMBER_PREFIX = 'sched-poll-rally';

/**
 * Dedup key for one poll's rally cooldown.
 *
 * Keyed by match, not by organiser: the cooldown protects the POLL's members
 * from a second fan-out, so a co-operator pressing Rally a minute later must
 * hit the same key.
 *
 * @param matchId - Scheduling match the rally targets.
 * @returns Key for `NotificationDedupService.checkAndMarkSent` / `releaseKey`.
 */
export function rallyCooldownKey(matchId: number): string {
  return `${RALLY_COOLDOWN_PREFIX}:${matchId}`;
}

/**
 * Per-member dedup key for one rally DM, scoped to the LEADING slot.
 *
 * The slot is in the key on purpose: the DM asks about a specific time, so
 * once the leader changes the same member is a legitimate target again.
 *
 * @param matchId - Match being rallied.
 * @param slotId - The leading slot the DM asks about.
 * @param userId - Recipient.
 * @returns Key for `NotificationDedupService.checkAndMarkSent` / `releaseKey`.
 */
export function rallyMemberKey(
  matchId: number,
  slotId: number,
  userId: number,
): string {
  return `${RALLY_MEMBER_PREFIX}:${matchId}:${slotId}:${userId}`;
}

/**
 * Members of a match with NO stance on the leading slot.
 *
 * Votes are presence-only rows carrying a stance, so any row for this member
 * on this slot — `yes` or `no` — excludes them: they have answered the
 * question the rally asks. Deactivated users are filtered here (not just
 * downstream) so a 6h key is never burnt on someone who cannot receive the DM.
 * Unlike the cron's `findPendingMemberIds` there is NO member-age floor: the
 * rally is a manual action, and a member added an hour ago is exactly who the
 * organiser means to reach.
 *
 * @param db - Drizzle database handle.
 * @param matchId - Match whose members are being classified.
 * @param slotId - The leading slot the rally asks about.
 * @returns User ids that still owe an answer on that slot.
 */
export async function findLeaderPendingMemberIds(
  db: Db,
  matchId: number,
  slotId: number,
): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT lmm.user_id AS "userId"
    FROM community_lineup_match_members lmm
    JOIN users u ON u.id = lmm.user_id AND u.deactivated_at IS NULL
    WHERE lmm.match_id = ${matchId}
      AND NOT EXISTS (
        SELECT 1
        FROM community_lineup_schedule_votes csv
        WHERE csv.slot_id = ${slotId}
          AND csv.user_id = lmm.user_id
      )
  `)) as unknown as Array<{ userId: number }>;
  return rows.map((r) => r.userId);
}

/**
 * How many members the poll has, for the DM's "X of N" framing.
 *
 * Mirrors what the poll page counts (`match.members.length`, from
 * `findMatchMembers`): one row per `community_lineup_match_members` entry with
 * a surviving user row, no deactivation filter — so the DM's denominator
 * matches the number the organiser is looking at.
 *
 * @param db - Drizzle database handle.
 * @param matchId - Match being rallied.
 * @returns Member count for the match.
 */
export async function countPollMembers(
  db: Db,
  matchId: number,
): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS "count"
    FROM community_lineup_match_members lmm
    JOIN users u ON u.id = lmm.user_id
    WHERE lmm.match_id = ${matchId}
  `)) as unknown as Array<{ count: number }>;
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

/** Unix seconds for a Discord `<t:…>` token. */
function unix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

/**
 * Title + message for the rally DM.
 *
 * `<t:UNIX:f>` renders in the recipient's own timezone (same token
 * `buildExpiryWarnCopy` uses), which matters because the whole point is
 * "does this time work for YOU".
 *
 * @param gameName - The poll's game.
 * @param yesCount - YES votes already on the leading slot.
 * @param memberCount - Total poll members, the "of N" denominator.
 * @param leadingIso - The leading slot's proposed time.
 * @returns Copy for `NotificationService.create`.
 */
export function buildRallyCopy(
  gameName: string,
  yesCount: number,
  memberCount: number,
  leadingIso: string,
): { title: string; message: string } {
  return {
    title: 'Does this time work for you?',
    message:
      `${yesCount} of ${memberCount} picked <t:${unix(leadingIso)}:f> ` +
      `for ${gameName}. Does it work for you? Vote, or say it doesn't.`,
  };
}

/** Collaborators one rally DM needs. Structural, so the service passes its own
 * injected instances and the unit spec passes plain mocks. */
export interface RallyDeps {
  notificationService: Pick<NotificationService, 'create'>;
  dedupService: Pick<NotificationDedupService, 'checkAndMarkSent'>;
}

/** Outcome of one attempted rally DM. */
export interface RallyDmResult {
  /** False when this (match, slot, user) was already rallied inside the 6h
   * window. True means this call owns the window — the key is burnt either
   * way, which is why the service releases it on a THROWN dispatch. */
  dispatched: boolean;
  /** True only when a notification row was created (preferences allowed it). */
  created: boolean;
}

/**
 * Notification payload for one rally DM.
 *
 * The link button is built generically from `lineupId` + `matchId` by
 * `notification-embed.buttons.ts::buildScheduleButton` ("Vote on a Time"), so
 * both ids are required; `slotId` rides along for debugging and any future
 * deep-link straight to the slot.
 *
 * @param poll - The poll supplying ids and the game name.
 * @param slotId - The leading slot the DM asks about.
 * @returns Payload for `NotificationService.create`.
 */
function rallyPayload(
  poll: NudgePoll,
  slotId: number,
): Record<string, unknown> {
  return {
    subtype: 'scheduling_poll_rally',
    // Per-poll rate bucket, distinct from the cron nudge's `poll-{id}`: a
    // member rallied in two polls gets two DMs (different deep links) rather
    // than one plus a silently dropped one.
    reminderWindow: `rally-${poll.matchId}`,
    lineupId: poll.lineupId,
    matchId: poll.matchId,
    slotId,
    gameName: poll.gameName,
  };
}

/**
 * Send one rally DM unless this (match, leading slot, user) was already
 * rallied inside the current 6h window.
 *
 * Dispatch failures propagate — the service counts the member as skipped and
 * hands their key back.
 *
 * @param deps - Notification + dedup collaborators.
 * @param poll - The poll supplying ids and the game name.
 * @param leader - The leading slot the DM asks about.
 * @param memberCount - Total poll members, for the "X of N" copy.
 * @param userId - Recipient.
 * @returns Whether the window was claimed and whether a row was created.
 */
export async function sendRallyDm(
  deps: RallyDeps,
  poll: NudgePoll,
  leader: LeadingSlot,
  memberCount: number,
  userId: number,
): Promise<RallyDmResult> {
  const alreadySent = await deps.dedupService.checkAndMarkSent(
    rallyMemberKey(poll.matchId, leader.slotId, userId),
    POLL_RALLY_COOLDOWN_SECONDS,
  );
  if (alreadySent) return { dispatched: false, created: false };

  const { title, message } = buildRallyCopy(
    poll.gameName,
    leader.voteCount,
    memberCount,
    leader.proposedTime,
  );
  const created = await deps.notificationService.create({
    userId,
    type: 'community_lineup',
    title,
    message,
    payload: rallyPayload(poll, leader.slotId),
  });
  return { dispatched: true, created: created !== null };
}
