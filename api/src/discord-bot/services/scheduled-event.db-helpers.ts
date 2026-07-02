import { eq, and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

export interface ScheduledEventRecord {
  discordScheduledEventId: string | null;
  notificationChannelOverride: string | null;
  recurrenceGroupId: string | null;
  /** ROK-1352: live ephemeral voice channel (resolver Tier 0). */
  ephemeralVoiceChannelId: string | null;
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
        // ROK-1370: skip events with an open reschedule poll — the start scan
        // must not fire on the stale time; it resumes once the poll locks in.
        isNull(schema.events.reschedulingPollId),
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
        // ROK-1370: don't auto-complete an event whose reschedule poll is open;
        // the SE is torn down at poll start and recreated at lock-in.
        isNull(schema.events.reschedulingPollId),
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
      ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
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

/** ROK-1352: recurrence group + live ephemeral channel for an event. */
async function getRecurrenceAndEphemeral(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{
  recurrenceGroupId: string | null;
  ephemeralVoiceChannelId: string | null;
}> {
  const [row] = await db
    .select({
      recurrenceGroupId: schema.events.recurrenceGroupId,
      ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return {
    recurrenceGroupId: row?.recurrenceGroupId ?? null,
    ephemeralVoiceChannelId: row?.ephemeralVoiceChannelId ?? null,
  };
}

/** Resolve voice channel for scheduled event creation (ROK-860 extraction).
 *  ROK-1352: passes the live ephemeral channel as resolver Tier 0. The
 *  per-event override still wins over Tier 0 (explicit operator intent). */
export async function resolveVoiceForCreate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId: number | null | undefined,
  override: string | null | undefined,
  channelResolver: {
    resolveVoiceChannelForScheduledEvent(
      gameId?: number | null,
      recurrenceGroupId?: string | null,
      ephemeralChannelId?: string | null,
    ): Promise<string | null>;
  },
): Promise<string | null> {
  const { recurrenceGroupId, ephemeralVoiceChannelId } =
    await getRecurrenceAndEphemeral(db, eventId);
  return (
    override ??
    (await channelResolver.resolveVoiceChannelForScheduledEvent(
      gameId,
      recurrenceGroupId,
      ephemeralVoiceChannelId,
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
        // ROK-1370: poll start deliberately tears the SE down — reconciliation
        // must not resurrect it at the old time while the poll is open.
        isNull(schema.events.reschedulingPollId),
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

/** Live RL event keyed by SE name + start, used for duplicate-SE detection (ROK-1347). */
export interface LiveRLEventMatch {
  id: number;
  discordScheduledEventId: string | null;
  title: string;
  /** `lower(duration)` as text — the event's scheduled start. Parsed to epoch
   *  via `new Date(startIso)` by the matcher. This MUST mirror how the Discord
   *  SE start was set at create time (`new Date(eventData.startTime)` where
   *  startTime is the SAME `lower(duration)::text`) so the dedup match key and
   *  the create-path key collapse identically regardless of session tz — both
   *  sides apply the identical `new Date(text)` transform (ROK-1347). */
  startIso: string;
}

/**
 * Find live (non-cancelled, future-or-ongoing) RL events so the GC matcher can
 * decide whether a guild SE NOT tracked in `discord_scheduled_event_id` is a
 * mis-classified RL-created duplicate (same title + start as a live event that
 * already has a DIFFERENT bound SE id) vs a genuine operator-owned orphan.
 *
 * Postgres `events.discord_scheduled_event_id` holds ONE id per row, so when a
 * duplicate SE is created (timeout-after-success race), the older SE id falls
 * out of the DB and the GC mis-classifies it as an operator orphan it can never
 * delete — the 80-orphan freeze this fixes (ROK-1347).
 *
 * Returns rows keyed by the caller via `seMatchKey(title, startIso)`.
 */
export async function findLiveRLEventsForDedup(
  db: PostgresJsDatabase<typeof schema>,
): Promise<LiveRLEventMatch[]> {
  const now = new Date();
  return db
    .select({
      id: schema.events.id,
      discordScheduledEventId: schema.events.discordScheduledEventId,
      title: schema.events.title,
      startIso: sql<string>`lower(${schema.events.duration})::text`,
    })
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.cancelledAt),
        sql`${schema.events.isAdHoc} = false`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    );
}

/** Clear the capacity backoff flag for the given events so the next reconcile
 *  tick recreates missing SEs immediately (ROK-1347 recovery path). */
export async function clearReconcileBackoff(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<void> {
  if (eventIds.length === 0) return;
  await db
    .update(schema.events)
    .set({ scheduledEventReconcileBackoffUntil: null })
    .where(inArray(schema.events.id, eventIds));
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
