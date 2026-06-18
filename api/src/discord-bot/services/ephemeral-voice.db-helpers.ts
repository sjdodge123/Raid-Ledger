import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/** Event fields the ephemeral-voice lifecycle needs (ROK-1352). */
export interface EphemeralEventRow {
  id: number;
  title: string;
  gameId: number | null;
  startTime: string;
  endTime: string;
  recurrenceGroupId: string | null;
  ephemeralVoiceEnabled: boolean | null;
  ephemeralVoiceChannelId: string | null;
}

const EVENT_FIELDS = {
  id: schema.events.id,
  title: schema.events.title,
  gameId: schema.events.gameId,
  startTime: sql<string>`lower(${schema.events.duration})::text`,
  endTime: sql<string>`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration}))::text`,
  recurrenceGroupId: schema.events.recurrenceGroupId,
  ephemeralVoiceEnabled: schema.events.ephemeralVoiceEnabled,
  ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
};

/**
 * Events whose start falls within `[now, now + bufferMs]`, are not cancelled,
 * and have no ephemeral channel yet. Gate resolution (global/series/override)
 * is applied per-candidate by the service. Window scan is naturally
 * idempotent + reschedule-safe (mirrors the SE start-scan).
 */
export async function findCreateCandidates(
  db: PostgresJsDatabase<typeof schema>,
  now: Date,
  bufferMs: number,
): Promise<EphemeralEventRow[]> {
  const until = new Date(now.getTime() + bufferMs);
  return db
    .select(EVENT_FIELDS)
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.cancelledAt),
        isNull(schema.events.ephemeralVoiceChannelId),
        sql`lower(${schema.events.duration}) >= ${now.toISOString()}::timestamptz`,
        sql`lower(${schema.events.duration}) <= ${until.toISOString()}::timestamptz`,
      ),
    );
}

/**
 * Events that have a live ephemeral channel whose effective end is more than
 * `idleMs` in the past — the reaper's delete candidates (occupancy re-checked
 * against Discord by the caller before delete).
 */
export async function findReapCandidates(
  db: PostgresJsDatabase<typeof schema>,
  now: Date,
  idleMs: number,
): Promise<EphemeralEventRow[]> {
  const cutoff = new Date(now.getTime() - idleMs);
  return db
    .select(EVENT_FIELDS)
    .from(schema.events)
    .where(
      and(
        isNotNull(schema.events.ephemeralVoiceChannelId),
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${cutoff.toISOString()}::timestamptz`,
      ),
    );
}

/** Fetch a single event's ephemeral-relevant fields. */
export async function fetchEventForEphemeral(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EphemeralEventRow | null> {
  const [row] = await db
    .select(EVENT_FIELDS)
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

/** Persist the live ephemeral channel id (set BEFORE SE create/repoint). */
export async function setEphemeralChannelId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  channelId: string,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ephemeralVoiceChannelId: channelId })
    .where(eq(schema.events.id, eventId));
}

/** Clear the ephemeral channel id (after the channel is destroyed). */
export async function clearEphemeralChannelId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ ephemeralVoiceChannelId: null })
    .where(eq(schema.events.id, eventId));
}

/** Minimal ScheduledEventData for re-pointing an SE after channel create/destroy. */
export interface RepointEventData {
  title: string;
  startTime: string;
  endTime: string;
  signupCount: number;
  game: { name: string } | null;
}

/** Build the SE re-point payload (game name + signup count) for an event. */
export async function buildRepointData(
  db: PostgresJsDatabase<typeof schema>,
  ev: EphemeralEventRow,
): Promise<RepointEventData> {
  let game: { name: string } | null = null;
  if (ev.gameId !== null) {
    const [g] = await db
      .select({ name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, ev.gameId))
      .limit(1);
    if (g) game = { name: g.name };
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, ev.id));
  return {
    title: ev.title,
    startTime: ev.startTime,
    endTime: ev.endTime,
    signupCount: count ?? 0,
    game,
  };
}

/** Find the event row that currently owns a given ephemeral channel id. */
export async function findEventByEphemeralChannel(
  db: PostgresJsDatabase<typeof schema>,
  channelId: string,
): Promise<EphemeralEventRow | null> {
  const [row] = await db
    .select(EVENT_FIELDS)
    .from(schema.events)
    .where(eq(schema.events.ephemeralVoiceChannelId, channelId))
    .limit(1);
  return row ?? null;
}
