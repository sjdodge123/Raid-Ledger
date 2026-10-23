/**
 * Helpers for event creation (single and recurring).
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CreateEventDto } from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { generateRecurringDates } from './recurrence.util';
import { defined } from '../common/defined.helpers';
import {
  findMatchPollHub,
  isLiveHubMemberOrStaff,
} from '../lineups/standalone-poll/standalone-poll-hub.helpers';

/**
 * ROK-1893 P3 (D16): an event created from a hub poll's match inherits the
 * poll's hub as its guild tag — only when the client sent none, the hub is
 * still visible, the event is for the hub's game, and the event's creator is
 * still a live (not left, not banned) member of the hub or staff.
 */
export async function inheritPollHub(
  db: PostgresJsDatabase<typeof schema>,
  dto: CreateEventDto,
  creatorId: number,
): Promise<CreateEventDto> {
  if (dto.guildId !== undefined || dto.schedulingMatchId === undefined) {
    return dto;
  }
  const hub = await findMatchPollHub(db, dto.schedulingMatchId);
  if (!hub || hub.gameId !== dto.gameId) return dto;
  if (!(await isLiveHubMemberOrStaff(db, hub.id, creatorId))) return dto;
  return { ...dto, guildId: hub.id };
}

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
    // ROK-1352: per-event ephemeral opt-in (null/false = no channel unless the
    // admin force-ephemeral setting is on). Recurring instances each inherit
    // this base value; later series edits propagate via PATCH /events/:id/series.
    ephemeralVoiceEnabled: dto.ephemeralVoiceEnabled ?? null,
    // ROK-1386: lock the ephemeral channel to rostered members only.
    privateVoice: dto.privateVoice ?? null,
    // ROK-1787: guild tag — recurring instances inherit it.
    guildId: dto.guildId ?? null,
    // ROK-1844: provenance for the poll-completion signup guard.
    createdFromPollId: dto.schedulingMatchId ?? null,
  };
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
  return defined(event, 'inserted event row');
}

/** Generates a recurrence group ID if the DTO has recurrence, else null. */
export function resolveRecurrenceGroupId(dto: CreateEventDto): string | null {
  return dto.recurrence ? randomUUID() : null;
}
