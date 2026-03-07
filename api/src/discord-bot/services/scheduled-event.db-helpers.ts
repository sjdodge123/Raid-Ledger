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
