import { eq, and, isNotNull, isNull, sql } from 'drizzle-orm';
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
      ),
    )
    .limit(5);
}
