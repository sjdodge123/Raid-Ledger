import type { Logger } from '@nestjs/common';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ScheduledEventData } from './scheduled-event.helpers';

/**
 * ROK-1391 — reschedule-poll lock-in race: create-time revalidation.
 *
 * The SE create pipeline is edge-triggered and fire-and-forget, so a create
 * carrying a stale pre-reschedule payload can land (or its bind survive) after a
 * newer poll-start teardown. These helpers close the TOCTOU: an entry guard
 * re-reads live state before the create, and a conditional bind + post-bind
 * re-read lets a losing create compensate (delete + unbind) itself.
 */

/**
 * Live create-time state for an event. `startIso`/`endIso` derive from
 * `lower/upper(duration)::text` — the SAME transform the create/adopt keys use —
 * so epoch comparisons collapse identically regardless of session timezone.
 */
export interface EventLiveState {
  reschedulingPollId: number | null;
  cancelledAt: Date | null;
  startIso: string;
  endIso: string;
}

/** Outcome of the create-time entry guard. `skipReason` non-null aborts the
 *  create; `eventData` carries fresh times when the payload had drifted. */
export interface CreateEntryGuardResult {
  skipReason: string | null;
  eventData: ScheduledEventData;
}

/**
 * Parse an event timestamp that may be EITHER an ISO-8601 string (job/DTO
 * payloads, offset-carrying) OR Postgres `lower/upper(duration)::text` output —
 * which for this NAIVE (no-offset) column prints `YYYY-MM-DD HH:MM:SS[.fff]`.
 * `new Date()` interprets a naive string in the PROCESS's local timezone, so a
 * cross-source comparison (ISO-Z payload vs naive row text) skews by the host's
 * UTC offset on any non-UTC deployment (4h on an EDT dev machine) — enough to
 * fire the start-mismatch compensation on perfectly fresh creates. Stored
 * values are UTC by convention (the driver serializes Dates via toISOString),
 * so a naive string is normalized to explicit UTC before parsing. Strings that
 * already carry an offset (Z / +hh / -hh:mm) parse unchanged.
 */
export function parseEventTimestampUtc(value: string | null | undefined): Date {
  if (typeof value !== 'string' || value.trim() === '') return new Date(NaN);
  const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.trim());
  if (hasOffset) return new Date(value);
  return new Date(value.trim().replace(' ', 'T') + 'Z');
}

/**
 * Read the live reschedule flag, cancellation, and derived start/end for an
 * event in a single row read. Returns null when the row is gone.
 */
export async function getEventLiveState(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventLiveState | null> {
  const [row] = await db
    .select({
      reschedulingPollId: schema.events.reschedulingPollId,
      cancelledAt: schema.events.cancelledAt,
      startIso: sql<string>`lower(${schema.events.duration})::text`,
      endIso: sql<string>`upper(${schema.events.duration})::text`,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * Conditionally bind the Discord SE id to an event. The UPDATE only matches when
 * the binding is still NULL or already equals `seId`, so a create that lost the
 * race to a newer poll-start teardown (which cleared the binding, or a different
 * SE already took it) reports `{ bound: false }` and the caller compensating-
 * deletes its own SE. The `OR = seId` leg keeps adopt / double-UPDATED
 * convergence on the SAME guild SE from self-clobbering into a delete.
 */
export async function saveScheduledEventId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  seId: string,
): Promise<{ bound: boolean }> {
  const rows = await db
    .update(schema.events)
    .set({ discordScheduledEventId: seId })
    .where(
      and(
        eq(schema.events.id, eventId),
        or(
          isNull(schema.events.discordScheduledEventId),
          eq(schema.events.discordScheduledEventId, seId),
        ),
      ),
    )
    .returning();
  return { bound: rows.length > 0 };
}

/**
 * Clear the SE binding only on the row that still points at `seId`. Used by
 * post-bind compensation so a stale-payload SE unbinds itself without clobbering
 * a newer binding a concurrent poll-start winner installed.
 */
export async function clearScheduledEventIdBySeId(
  db: PostgresJsDatabase<typeof schema>,
  seId: string,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ discordScheduledEventId: null })
    .where(eq(schema.events.discordScheduledEventId, seId));
}

/**
 * Create-time live-state revalidation. Run after the id precheck with the row's
 * live state: skip when a reschedule poll is open or the event is cancelled (a
 * fire-and-forget create must not resurrect a torn-down / stale SE), otherwise
 * substitute the fresh row start/end over a drifted payload and re-apply the
 * past-start check against the FRESH start (the earlier `getCreateSkipReason`
 * ran on the stale payload). `live` null passes the payload through unchanged.
 */
/**
 * Read live state and apply the create-time entry guard, logging + returning
 * null when the create should be skipped, otherwise the (possibly fresh-time-
 * substituted) event data. Keeps the guard off `createScheduledEventIdempotent`.
 */
export async function applyCreateEntryGuard(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  eventId: number,
  eventData: ScheduledEventData,
): Promise<ScheduledEventData | null> {
  const guard = resolveCreateEntryGuard(
    await getEventLiveState(db, eventId),
    eventData,
  );
  if (guard.skipReason) {
    logger.warn(`Skip SE ${eventId}: ${guard.skipReason}`);
    return null;
  }
  return guard.eventData;
}

export function resolveCreateEntryGuard(
  live: EventLiveState | null,
  eventData: ScheduledEventData,
): CreateEntryGuardResult {
  if (!live) return { skipReason: null, eventData };
  if (live.reschedulingPollId != null)
    return { skipReason: 'reschedule poll open', eventData };
  if (live.cancelledAt != null)
    return { skipReason: 'event cancelled', eventData };
  const fresh = substituteFreshTimes(eventData, live);
  if (parseEventTimestampUtc(fresh.startTime).getTime() <= Date.now())
    return { skipReason: 'fresh start time in the past', eventData: fresh };
  return { skipReason: null, eventData: fresh };
}

/** Swap the payload start/end for the live row's derived times when they drifted.
 *  Invalid/absent row times leave the payload untouched. */
function substituteFreshTimes(
  eventData: ScheduledEventData,
  live: EventLiveState,
): ScheduledEventData {
  const freshStart = parseEventTimestampUtc(live.startIso);
  const freshEnd = parseEventTimestampUtc(live.endIso);
  if (Number.isNaN(freshStart.getTime()) || Number.isNaN(freshEnd.getTime()))
    return eventData;
  if (
    freshStart.getTime() ===
      parseEventTimestampUtc(eventData.startTime).getTime() &&
    freshEnd.getTime() === parseEventTimestampUtc(eventData.endTime).getTime()
  )
    return eventData;
  return {
    ...eventData,
    startTime: freshStart.toISOString(),
    endTime: freshEnd.toISOString(),
  };
}
