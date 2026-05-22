/**
 * Recruitment reminder query helpers.
 * Extracted from recruitment-reminder.service.ts for file size compliance (ROK-711).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

export interface EligibleEvent {
  id: number;
  title: string;
  gameId: number;
  gameName: string;
  creatorId: number;
  startTime: string;
  maxAttendees: number | null;
  signupCount: number;
  channelId: string;
  guildId: string;
  messageId: string;
  createdAt: string;
  /** Needed by ChannelResolverService to walk the series-binding tier (ROK-1335). */
  recurrenceGroupId: string | null;
  /** Per-event override that short-circuits the resolver (ROK-1335). */
  notificationChannelOverride: string | null;
}

/** Raw row shape returned by the eligible events query. */
interface EligibleEventRow {
  id: number;
  title: string;
  game_id: number;
  game_name: string;
  creator_id: number;
  start_time: string;
  max_attendees: number | null;
  signup_count: string;
  channel_id: string;
  guild_id: string;
  message_id: string;
  created_at: string;
  recurrence_group_id: string | null;
  notification_channel_override: string | null;
  [key: string]: unknown;
}

/** Map a raw DB row to an EligibleEvent DTO. */
function mapEligibleRow(r: EligibleEventRow): EligibleEvent {
  return {
    id: r.id,
    title: r.title,
    gameId: r.game_id,
    gameName: r.game_name,
    creatorId: r.creator_id,
    startTime: r.start_time,
    maxAttendees: r.max_attendees,
    signupCount: parseInt(r.signup_count, 10),
    channelId: r.channel_id,
    guildId: r.guild_id,
    messageId: r.message_id,
    createdAt: r.created_at,
    recurrenceGroupId: r.recurrence_group_id ?? null,
    notificationChannelOverride: r.notification_channel_override ?? null,
  };
}

/** Find future, non-cancelled events starting within [now, now + 48h] that have a Discord embed, are NOT full, and have a game. */
export async function findEligibleEvents(
  db: PostgresJsDatabase<typeof schema>,
): Promise<EligibleEvent[]> {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const rows = await db.execute<EligibleEventRow>(sql`
    SELECT e.id, e.title, e.game_id, g.name AS game_name, e.creator_id,
      lower(e.duration)::text AS start_time, e.max_attendees, e.created_at::text AS created_at,
      e.recurrence_group_id::text AS recurrence_group_id,
      e.notification_channel_override,
      (SELECT count(*) FROM event_signups es WHERE es.event_id = e.id AND es.status NOT IN ('roached_out', 'departed', 'declined'))::text AS signup_count,
      dem.channel_id, dem.guild_id, dem.message_id
    FROM events e
    INNER JOIN games g ON g.id = e.game_id
    INNER JOIN discord_event_messages dem ON dem.event_id = e.id
    WHERE e.cancelled_at IS NULL
      AND e.rescheduling_poll_id IS NULL
      AND lower(e.duration) >= ${now.toISOString()}::timestamptz
      AND lower(e.duration) <= ${in48h.toISOString()}::timestamptz
      AND dem.embed_state != 'full' AND e.game_id IS NOT NULL
      AND (SELECT count(*) FROM event_signups es2 WHERE es2.event_id = e.id AND es2.status NOT IN ('roached_out', 'departed', 'declined'))
        < COALESCE(
          CASE
            WHEN e.slot_config->>'type' = 'mmo' THEN COALESCE((e.slot_config->>'tank')::int, 0) + COALESCE((e.slot_config->>'healer')::int, 0) + COALESCE((e.slot_config->>'dps')::int, 0) + COALESCE((e.slot_config->>'flex')::int, 0)
            WHEN e.slot_config->>'player' IS NOT NULL THEN (e.slot_config->>'player')::int
            ELSE NULL
          END, e.max_attendees, 2147483647)
  `);
  return rows.map(mapEligibleRow);
}

/** Find users with game affinity who have no signup record for this event. */
export async function findRecipients(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  creatorId: number,
  eventId: number,
): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT DISTINCT u.id FROM users u
    WHERE u.id != ${creatorId}
      AND (u.id IN (SELECT gi.user_id FROM game_interests gi WHERE gi.game_id = ${gameId})
        OR u.id IN (SELECT es.user_id FROM event_signups es INNER JOIN events e ON e.id = es.event_id
          WHERE e.game_id = ${gameId} AND upper(e.duration) < NOW()::timestamp AND es.status = 'signed_up' AND e.cancelled_at IS NULL AND es.user_id IS NOT NULL))
      AND u.id NOT IN (SELECT es.user_id FROM event_signups es WHERE es.event_id = ${eventId} AND es.user_id IS NOT NULL)
  `);
  return rows.map((r) => r.id);
}

/** Find users with an absence covering the event date. */
export async function findAbsentUsers(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
  startTime: string,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const eventDate = new Date(startTime).toISOString().split('T')[0];
  const rows = await db.execute<{ user_id: number }>(sql`
    SELECT DISTINCT a.user_id FROM game_time_absences a
    WHERE a.user_id IN (${sql.join(userIds, sql`, `)})
      AND ${eventDate} >= a.start_date AND ${eventDate} <= a.end_date
  `);
  return new Set(rows.map((r) => r.user_id));
}

/** Build signup summary string. */
export function buildSignupSummary(event: EligibleEvent): string {
  return event.maxAttendees
    ? `${event.signupCount}/${event.maxAttendees} spots filled`
    : `${event.signupCount} signed up`;
}

/** Build the Discord embed URL for an event. */
export function buildDiscordUrl(event: EligibleEvent): string {
  return `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Default short-notice threshold (hours). Events whose
 * `start_time - created_at` gap is below this value are SUPPRESSED entirely
 * — neither channel bumps nor recruitment DMs fire. Override via the
 * `RECRUITMENT_SHORT_NOTICE_HOURS` env var. ROK-1240.
 */
export const DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS = 12;

/**
 * Read the short-notice suppression threshold (hours) from env, falling
 * back to {@link DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS}. Invalid /
 * non-positive values are ignored.
 */
export function getShortNoticeThresholdHours(): number {
  const raw = process.env.RECRUITMENT_SHORT_NOTICE_HOURS;
  if (!raw) return DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SHORT_NOTICE_THRESHOLD_HOURS;
}

/**
 * Compare two timestamps for same calendar day in the supplied timezone.
 * Uses {@link Intl.DateTimeFormat} (not UTC string slicing) so the
 * result reflects the community's wall-clock day. ROK-1240.
 */
export function isSameCalendarDay(
  a: number | Date,
  b: number | Date,
  timezone: string,
): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(a)) === fmt.format(new Date(b));
}

/**
 * Render a short relative time label for a future event start time.
 *
 * Returns one of:
 *  - `"now"`        — start is in the past or within the current rounded hour
 *  - `"today"`      — start is on the same calendar day as `now` (TZ-aware)
 *  - `"tomorrow"`   — start is within ~24h but on a different calendar day
 *  - `"in Xh"`      — start is more than 24h out
 *
 * Replaces an inline ternary that produced `"tomorrow"` for same-day
 * events (ROK-1240). Always pass the community default timezone so the
 * "today" boundary respects the operator's wall clock.
 */
export function formatRelativeTimeLabel(
  startTime: string | Date,
  now: number,
  timezone: string,
): string {
  const start = new Date(startTime).getTime();
  const msUntil = start - now;
  const hoursUntil = Math.round(msUntil / HOUR_MS);
  if (hoursUntil <= 0) return 'now';
  if (hoursUntil < 24 && isSameCalendarDay(start, now, timezone)) {
    return 'today';
  }
  if (hoursUntil <= 24) return 'tomorrow';
  return `in ${hoursUntil}h`;
}

/**
 * Calculate the grace period in milliseconds for a newly created event.
 * Events created far in advance (>= 72h) get no grace period.
 * Events created closer to start time get a shorter grace to prevent
 * immediate recruitment reminders before signups have time to come in.
 */
export function calculateGracePeriodMs(
  createdAt: string,
  startTime: string,
): number {
  const timeUntilEvent =
    new Date(startTime).getTime() - new Date(createdAt).getTime();
  if (timeUntilEvent >= 72 * HOUR_MS) return 0;
  if (timeUntilEvent >= 48 * HOUR_MS) return 12 * HOUR_MS;
  if (timeUntilEvent >= 24 * HOUR_MS) return 6 * HOUR_MS;
  if (timeUntilEvent >= 12 * HOUR_MS) return 3 * HOUR_MS;
  return 1 * HOUR_MS;
}

/**
 * Returns true when the event should be SUPPRESSED outright because the
 * gap between creation and start is below the short-notice threshold —
 * i.e. the event was scheduled too close to start time for a recruitment
 * nag to be useful. Suppression covers BOTH the channel bump and the
 * recipient DMs (they share a single gating call).
 *
 * Defensive: `start <= created` (clock skew, data anomaly) is treated as
 * suppressed. ROK-1240.
 */
export function isShortNoticeEvent(
  event: Pick<EligibleEvent, 'createdAt' | 'startTime'>,
  thresholdHours: number = getShortNoticeThresholdHours(),
): boolean {
  const timeUntilEvent =
    new Date(event.startTime).getTime() - new Date(event.createdAt).getTime();
  if (timeUntilEvent <= 0) return true;
  return timeUntilEvent < thresholdHours * HOUR_MS;
}

/**
 * Check whether an event is still within its creation grace period OR is
 * a short-notice event that should be suppressed entirely.
 *
 * Returns true if the event should be skipped (grace active OR
 * short-notice), false if it should be processed.
 * @param event - The eligible event to check
 * @param now - Optional timestamp (ms) to use instead of Date.now()
 */
export function isWithinGracePeriod(
  event: EligibleEvent,
  now?: number,
): boolean {
  // Short-notice events are suppressed regardless of how much time has
  // elapsed since creation — their start_time is just too close to now
  // for a recruitment nag to be useful. ROK-1240.
  if (isShortNoticeEvent(event)) return true;

  const gracePeriodMs = calculateGracePeriodMs(
    event.createdAt,
    event.startTime,
  );
  if (gracePeriodMs === 0) return false;
  const currentTime = now ?? Date.now();
  return currentTime < new Date(event.createdAt).getTime() + gracePeriodMs;
}
