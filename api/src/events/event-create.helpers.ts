/**
 * Helpers for event creation (single and recurring).
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CreateEventDto } from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { generateRecurringDates } from './recurrence.util';

/** Builds the base insert values shared by single and recurring events. */
export function buildBaseValues(
  creatorId: number,
  dto: CreateEventDto,
  recurrenceGroupId: string | null,
): Record<string, unknown> {
  return {
    title: dto.title,
    description: dto.description ?? null,
    gameId: dto.gameId ?? null,
    creatorId,
    slotConfig: dto.slotConfig ?? null,
    maxAttendees: dto.maxAttendees ?? null,
    autoUnbench: dto.autoUnbench ?? true,
    recurrenceGroupId,
    recurrenceRule: dto.recurrence ?? null,
    contentInstances: dto.contentInstances ?? null,
    reminder15min: dto.reminder15min ?? true,
    reminder1hour: dto.reminder1hour ?? false,
    reminder24hour: dto.reminder24hour ?? false,
    // ROK-1352: per-event ephemeral override (null = inherit series/global).
    ephemeralVoiceEnabled: dto.ephemeralVoiceEnabled ?? null,
  };
}

/**
 * ROK-1352: When an event opts into ephemeral voice at series scope, persist
 * the series-level flag so every instance inherits it. Scope 'this' (or absent)
 * relies on the per-event column written by `buildBaseValues`.
 */
export async function applyEphemeralSeriesScope(
  db: PostgresJsDatabase<typeof schema>,
  dto: CreateEventDto,
  recurrenceGroupId: string | null,
): Promise<void> {
  const seriesScope =
    dto.ephemeralVoiceScope === 'all' ||
    dto.ephemeralVoiceScope === 'this_and_following';
  if (
    !seriesScope ||
    !recurrenceGroupId ||
    dto.ephemeralVoiceEnabled == null
  ) {
    return;
  }
  await db
    .insert(schema.eventSeriesSettings)
    .values({
      recurrenceGroupId,
      ephemeralVoiceEnabled: dto.ephemeralVoiceEnabled,
    })
    .onConflictDoUpdate({
      target: schema.eventSeriesSettings.recurrenceGroupId,
      set: {
        ephemeralVoiceEnabled: dto.ephemeralVoiceEnabled,
        updatedAt: new Date(),
      },
    });
}

/** Inserts recurring event instances and returns their DB rows. */
export async function insertRecurringEvents(
  db: PostgresJsDatabase<typeof schema>,
  dto: CreateEventDto,
  baseValues: Record<string, unknown>,
  startTime: Date,
  durationMs: number,
): Promise<(typeof schema.events.$inferSelect)[]> {
  const instances = generateRecurringDates(
    startTime,
    dto.recurrence!.frequency,
    new Date(dto.recurrence!.until),
  );
  const allValues = instances.map((instanceStart) => ({
    ...baseValues,
    duration: [
      instanceStart,
      new Date(instanceStart.getTime() + durationMs),
    ] as [Date, Date],
  }));
  return db
    .insert(schema.events)
    .values(allValues as never)
    .returning();
}

/** Inserts a single (non-recurring) event and returns its DB row. */
export async function insertSingleEvent(
  db: PostgresJsDatabase<typeof schema>,
  baseValues: Record<string, unknown>,
  startTime: Date,
  endTime: Date,
): Promise<typeof schema.events.$inferSelect> {
  const [event] = await db
    .insert(schema.events)
    .values({ ...baseValues, duration: [startTime, endTime] } as never)
    .returning();
  return event;
}

/** Generates a recurrence group ID if the DTO has recurrence, else null. */
export function resolveRecurrenceGroupId(dto: CreateEventDto): string | null {
  return dto.recurrence ? randomUUID() : null;
}
