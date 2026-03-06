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
      lower(e.duration)::text AS start_time, e.max_attendees,
      (SELECT count(*) FROM event_signups es WHERE es.event_id = e.id AND es.status NOT IN ('roached_out', 'departed', 'declined'))::text AS signup_count,
      dem.channel_id, dem.guild_id, dem.message_id
    FROM events e
    INNER JOIN games g ON g.id = e.game_id
    INNER JOIN discord_event_messages dem ON dem.event_id = e.id
    WHERE e.cancelled_at IS NULL
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
