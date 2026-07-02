/**
 * Series-aware active-event resolution for voice attendance (ROK-1389).
 *
 * Extracted from voice-attendance-flush.helpers.ts (already at the 300-line cap)
 * — mirrors the voice-attendance-ephemeral.helpers.ts precedent.
 *
 * A series voice channel binding carries a recurrence_group_id, but the binding's
 * stored gameId can differ from (or be null vs) this week's instance gameId. The
 * gameId-only query in findActiveEventsForChannel therefore misses the live
 * instance, breaking join tracking → reminder suppression → classification. This
 * unions the events matched by the binding's recurrence group into the result,
 * deduped by event id, so the channel maps to the instance regardless of gameId.
 */
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type ActiveEvent = { eventId: number; gameId: number | null };

/**
 * Query active (started, not-past-end, not-cancelled, non-ad-hoc) events whose
 * recurrence_group_id is in `groups`. Deliberately does NOT require a non-null
 * gameId — a variety-night instance (gameId NULL) still shares the group.
 */
export async function queryActiveEventsByRecurrenceGroups(
  db: Db,
  groups: string[],
  now: Date,
): Promise<ActiveEvent[]> {
  if (groups.length === 0) return [];
  const rows = await db
    .select({ id: schema.events.id, gameId: schema.events.gameId })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.isAdHoc, false),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
        sql`${schema.events.recurrenceGroupId} IN (${sql.join(
          groups.map((g) => sql`${g}`),
          sql`, `,
        )})`,
      ),
    );
  return rows.map((e) => ({ eventId: e.id, gameId: e.gameId }));
}

/** Unique recurrence group ids across the matched voice bindings. */
function extractRecurrenceGroups(
  bindings: Array<{ recurrenceGroupId?: string | null }>,
): string[] {
  const groups = new Set<string>();
  for (const b of bindings)
    if (b.recurrenceGroupId) groups.add(b.recurrenceGroupId);
  return [...groups];
}

/** Merge active-event lists, keeping the first occurrence per event id. */
function dedupeById(events: ActiveEvent[]): ActiveEvent[] {
  const seen = new Map<number, ActiveEvent>();
  for (const e of events) if (!seen.has(e.eventId)) seen.set(e.eventId, e);
  return [...seen.values()];
}

/**
 * Union `baseEvents` (the gameId / all-games result) with events matched by the
 * matched bindings' recurrence groups, deduped by event id. When no matched
 * binding carries a recurrence group the series query is skipped entirely.
 */
export async function unionSeriesEvents(
  db: Db,
  matched: Array<{ recurrenceGroupId?: string | null }>,
  baseEvents: ActiveEvent[],
  now: Date,
): Promise<ActiveEvent[]> {
  const groups = extractRecurrenceGroups(matched);
  const seriesEvents = await queryActiveEventsByRecurrenceGroups(
    db,
    groups,
    now,
  );
  return dedupeById([...baseEvents, ...seriesEvents]);
}
