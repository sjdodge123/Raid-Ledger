import { eq, and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

export interface ScheduledEventRecord {
  discordScheduledEventId: string | null;
  notificationChannelOverride: string | null;
  recurrenceGroupId: string | null;
}

export async function findStartCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ id: number; discordScheduledEventId: string | null }>> {
  const now = new Date();
  return db
    .select({
      id: schema.events.id,
      discordScheduledEventId: schema.events.discordScheduledEventId,
    })
    .from(schema.events)
    .where(
      and(
        isNotNull(schema.events.discordScheduledEventId),
        isNull(schema.events.cancelledAt),
        sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    );
}

export async function findCompletionCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ id: number; discordScheduledEventId: string | null }>> {
  const now = new Date();
  return db
    .select({
      id: schema.events.id,
      discordScheduledEventId: schema.events.discordScheduledEventId,
    })
    .from(schema.events)
    .where(
      and(
        isNotNull(schema.events.discordScheduledEventId),
        isNull(schema.events.cancelledAt),
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) < ${now.toISOString()}::timestamptz`,
      ),
    );
}

export async function getScheduledEventId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<string | null> {
  const [event] = await db
    .select({
      discordScheduledEventId: schema.events.discordScheduledEventId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event?.discordScheduledEventId ?? null;
}

export async function getEventWithOverride(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<ScheduledEventRecord | null> {
  const [event] = await db
    .select({
      discordScheduledEventId: schema.events.discordScheduledEventId,
      notificationChannelOverride: schema.events.notificationChannelOverride,
      recurrenceGroupId: schema.events.recurrenceGroupId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

export async function saveScheduledEventId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  seId: string,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ discordScheduledEventId: seId })
    .where(eq(schema.events.id, eventId));
}

export async function clearScheduledEventId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ discordScheduledEventId: null })
    .where(eq(schema.events.id, eventId));
}

export async function getRecurrenceGroupId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<string | null | undefined> {
  const [row] = await db
    .select({ recurrenceGroupId: schema.events.recurrenceGroupId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.recurrenceGroupId;
}

/** Resolve voice channel for scheduled event creation (ROK-860 extraction). */
export async function resolveVoiceForCreate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId: number | null | undefined,
  override: string | null | undefined,
  channelResolver: {
    resolveVoiceChannelForScheduledEvent(
      gameId?: number | null,
      recurrenceGroupId?: string | null,
    ): Promise<string | null>;
  },
): Promise<string | null> {
  const rgId = await getRecurrenceGroupId(db, eventId);
  return (
    override ??
    (await channelResolver.resolveVoiceChannelForScheduledEvent(
      gameId,
      rgId,
    )) ??
    null
  );
}

/** Maximum number of events to reconcile per batch (ROK-755, ROK-969). */
export const RECONCILIATION_BATCH_SIZE = 5;

/** Reconciliation candidate shape (ROK-755). */
export interface ReconciliationCandidate {
  id: number;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  gameId: number | null;
  isAdHoc: boolean;
  notificationChannelOverride: string | null;
  signupCount: number;
  maxAttendees: number | null;
}

/** Find future non-cancelled, non-ad-hoc events missing a Discord scheduled event (ROK-755). */
export async function findReconciliationCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<ReconciliationCandidate[]> {
  const now = new Date();
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      description: schema.events.description,
      startTime: sql<string>`lower(${schema.events.duration})::text`,
      endTime: sql<string>`upper(${schema.events.duration})::text`,
      gameId: schema.events.gameId,
      isAdHoc: schema.events.isAdHoc,
      notificationChannelOverride: schema.events.notificationChannelOverride,
      signupCount: sql<number>`0`,
      maxAttendees: schema.events.maxAttendees,
    })
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.discordScheduledEventId),
        isNull(schema.events.cancelledAt),
        sql`${schema.events.isAdHoc} = false`,
        sql`lower(${schema.events.duration}) > ${now.toISOString()}::timestamptz`,
        // ROK-1332: Skip rows currently in capacity-backoff. NULL means never
        // backed off (the common case); a past timestamp means the backoff
        // window expired and the row is eligible again.
        sql`(${schema.events.scheduledEventReconcileBackoffUntil} IS NULL OR ${schema.events.scheduledEventReconcileBackoffUntil} <= NOW())`,
      ),
    )
    .limit(RECONCILIATION_BATCH_SIZE);
}

/** Row shape returned by findRLTrackedSEs for GC's stale-check (ROK-1332). */
export interface RLTrackedSERow {
  id: number;
  discordScheduledEventId: string;
  /** True when the SE should have been cleaned up already: the RL row is
   *  cancelled OR its effective end (extendedUntil ?? upper(duration)) is more
   *  than 1h in the past. Computed server-side to avoid timezone skew. */
  isStale: boolean;
}

/**
 * Look up RL-tracked events whose discord_scheduled_event_id is in the given
 * seIds list. Used by gcStaleRLScheduledEvents to decide which guild SEs are
 * candidates for stale-deletion vs operator-orphans (ROK-1332).
 *
 * Staleness is computed IN SQL (not JS) for two reasons:
 *   1. The `duration` tsrange and `extended_until` columns are timezone-less;
 *      pulling `upper(duration)` as a string and `new Date()`-parsing it in JS
 *      interprets it as local time → a multi-hour skew on the 1h comparison.
 *   2. It mirrors the sibling reconciliation/completion queries by using
 *      `COALESCE(extended_until, upper(duration))` so an auto-extended event
 *      that is still live (members in voice past the original end) is NOT
 *      treated as stale and its Discord SE is preserved.
 */
export async function findRLTrackedSEs(
  db: PostgresJsDatabase<typeof schema>,
  seIds: string[],
): Promise<RLTrackedSERow[]> {
  if (seIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.events.id,
      discordScheduledEventId: schema.events.discordScheduledEventId,
      isStale: sql<boolean>`(
        ${schema.events.cancelledAt} IS NOT NULL
        OR COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration}))
             < NOW() - INTERVAL '1 hour'
      )`,
    })
    .from(schema.events)
    .where(
      and(
        isNotNull(schema.events.discordScheduledEventId),
        inArray(schema.events.discordScheduledEventId, seIds),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    discordScheduledEventId: r.discordScheduledEventId!,
    isStale: r.isStale,
  }));
}

/**
 * Set scheduled_event_reconcile_backoff_until on the given event rows. Used
 * by the reconciliation cron to pause retries when Discord's guild-wide cap
 * remains saturated after GC (ROK-1332).
 */
export async function setReconcileBackoff(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
  expiresAt: Date,
): Promise<void> {
  if (eventIds.length === 0) return;
  await db
    .update(schema.events)
    .set({ scheduledEventReconcileBackoffUntil: expiresAt })
    .where(inArray(schema.events.id, eventIds));
}
