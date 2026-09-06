/**
 * Small event reads for the LFG "playing now" spawner (ROK-1494).
 *
 * Kept out of the service so they are unit-testable against the drizzle mock,
 * and out of `ephemeral-voice.db-helpers.ts` so the ROK-1352 file keeps its
 * shape. Both reads are narrowed to LFG-BORN events (`is_ad_hoc` +
 * `channel_binding_id IS NULL`), so a Quick Play roster change can never emit
 * an LFG `GROUP_CHANGED`.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EphemeralEventRow } from '../services/ephemeral-voice.db-helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The LFG-born discriminator: ad-hoc, with no channel binding (D2). */
const LFG_BORN = and(
  eq(schema.events.isAdHoc, true),
  isNull(schema.events.channelBindingId),
);

/**
 * Load the ephemeral-voice view of a spawned event.
 *
 * @param db - Drizzle handle.
 * @param eventId - The spawned event.
 * @returns The row `EphemeralVoiceService.createForEvent` needs, or null.
 */
export async function loadLfgNowEphemeralRow(
  db: Db,
  eventId: number,
): Promise<EphemeralEventRow | null> {
  const [row] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      gameId: schema.events.gameId,
      startTime: sql<string>`lower(${schema.events.duration})::text`,
      endTime: sql<string>`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration}))::text`,
      recurrenceGroupId: schema.events.recurrenceGroupId,
      ephemeralVoiceEnabled: schema.events.ephemeralVoiceEnabled,
      ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
      privateVoice: schema.events.privateVoice,
    })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), LFG_BORN))
    .limit(1);
  return row ?? null;
}

/**
 * The game an LFG-born event belongs to.
 *
 * @param db - Drizzle handle.
 * @param eventId - Event whose roster changed.
 * @returns The game id, or null when the event is not an LFG-born one.
 */
export async function lfgNowEventGameId(
  db: Db,
  eventId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ gameId: schema.events.gameId })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), LFG_BORN))
    .limit(1);
  return row?.gameId ?? null;
}

/**
 * The game of an event the LFG spawner actually MINTED.
 *
 * Stricter than {@link lfgNowEventGameId} by design: this one also requires the
 * provenance link the spawn writes (`lfg_intents.converted_to_event_id`), so a
 * binding-less ad-hoc event that LFG never created cannot be mistaken for a
 * spawned session. {@link lfgNowEventGameId} is a re-render hint for an event
 * that is live; this one authorises a TERMINAL emit, which closes the group's
 * post and its `lfg_group_messages` row — a false positive there would close a
 * post that belongs to somebody else's group.
 *
 * Deliberately carries no status filter: the caller (the reaper) has already
 * ended the event, so an `adHocStatus` predicate would never match.
 *
 * @param db - Drizzle handle.
 * @param eventId - Event that just ended.
 * @returns The game id, or null when the event was not spawned by LFG.
 */
export async function lfgSpawnedEventGameId(
  db: Db,
  eventId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ gameId: schema.events.gameId })
    .from(schema.events)
    .innerJoin(
      schema.lfgIntents,
      eq(schema.lfgIntents.convertedToEventId, schema.events.id),
    )
    .where(and(eq(schema.events.id, eventId), LFG_BORN))
    .limit(1);
  return row?.gameId ?? null;
}
