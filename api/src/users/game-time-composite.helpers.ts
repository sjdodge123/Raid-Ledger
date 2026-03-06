/**
 * Composite view helpers for GameTimeService.
 * Extracted from game-time.service.ts for file size compliance (ROK-711).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  CompositeSlot,
  EventBlockDescriptor,
  SignedUpEventRow,
  CompositeViewResult,
  OverrideRecord,
  AbsenceRecord,
} from './game-time.types';

/** Fetch signed-up events for a specific week with game/creator data. */
export async function fetchWeekSignedUpEvents(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  weekStart: Date,
  weekEnd: Date,
): Promise<SignedUpEventRow[]> {
  const weekRange = `[${weekStart.toISOString()},${weekEnd.toISOString()})`;
  return db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      description: schema.events.description,
      duration: schema.events.duration,
      signupId: schema.eventSignups.id,
      confirmationStatus: schema.eventSignups.confirmationStatus,
      gameId: schema.games.id,
      gameSlug: schema.games.slug,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      creatorId: schema.events.creatorId,
      creatorUsername: schema.users.username,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.eventSignups.eventId, schema.events.id))
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .where(and(eq(schema.eventSignups.userId, userId), sql`${schema.events.duration} && ${weekRange}::tsrange`));
}

/** Signup preview map type. */
type SignupsPreviewMap = Map<number, { preview: Array<{ id: number; username: string; avatar: string | null; characters?: Array<{ gameId: number; avatarUrl: string | null }> }>; count: number }>;

/** Fetch signups for the given events with preview data and character avatars. */
export async function fetchSignupsPreview(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<SignupsPreviewMap> {
  const signupsMap: SignupsPreviewMap = new Map();
  if (eventIds.length === 0) return signupsMap;
  const { allSignups, countMap } = await fetchRawSignupData(db, eventIds);
  const allSignupUsers = buildSignupPreviewMap(eventIds, allSignups, countMap, signupsMap);
  await attachCharactersToSignups(db, allSignupUsers, signupsMap);
  return signupsMap;
}

/** Fetch raw signup rows and counts for given event IDs. */
async function fetchRawSignupData(db: PostgresJsDatabase<typeof schema>, eventIds: number[]) {
  const allSignups = await db
    .select({
      eventId: schema.eventSignups.eventId, signupId: schema.eventSignups.id,
      userId: schema.eventSignups.userId, username: schema.users.username,
      avatar: schema.users.avatar,
      rowNum: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${schema.eventSignups.eventId} ORDER BY ${schema.eventSignups.id})`.as('row_num'),
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(inArray(schema.eventSignups.eventId, eventIds));

  const allCounts = await db
    .select({ eventId: schema.eventSignups.eventId, count: sql<number>`count(*)::int` })
    .from(schema.eventSignups)
    .where(inArray(schema.eventSignups.eventId, eventIds))
    .groupBy(schema.eventSignups.eventId);

  return { allSignups, countMap: new Map(allCounts.map((c) => [c.eventId, c.count])) };
}

/** Populate the signups preview map and return all signup user IDs. */
function buildSignupPreviewMap(
  eventIds: number[],
  allSignups: Array<{ eventId: number; userId: number | null; username: string; avatar: string | null; rowNum: number }>,
  countMap: Map<number, number>,
  signupsMap: SignupsPreviewMap,
): number[] {
  const allSignupUsers: number[] = [];
  for (const eventId of eventIds) {
    const eventSignups = allSignups.filter((s) => s.eventId === eventId && s.rowNum <= 6);
    for (const s of eventSignups) { if (s.userId !== null) allSignupUsers.push(s.userId); }
    signupsMap.set(eventId, {
      preview: eventSignups.filter((s) => s.userId !== null).map((s) => ({ id: s.userId as number, username: s.username, avatar: s.avatar })),
      count: countMap.get(eventId) ?? 0,
    });
  }
  return allSignupUsers;
}

/** Attach character avatar data to signup preview entries. */
async function attachCharactersToSignups(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
  signupsMap: Map<number, { preview: Array<{ id: number; characters?: Array<{ gameId: number; avatarUrl: string | null }> }> }>,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;

  const charactersData = await db
    .select({ userId: schema.characters.userId, gameId: schema.characters.gameId, avatarUrl: schema.characters.avatarUrl })
    .from(schema.characters)
    .where(inArray(schema.characters.userId, uniqueUserIds));

  const charactersByUser = new Map<number, Array<{ gameId: number; avatarUrl: string | null }>>();
  for (const char of charactersData) {
    if (!charactersByUser.has(char.userId)) charactersByUser.set(char.userId, []);
    charactersByUser.get(char.userId)!.push({ gameId: char.gameId, avatarUrl: char.avatarUrl });
  }

  for (const entry of signupsMap.values()) {
    for (const signup of entry.preview) {
      const chars = charactersByUser.get(signup.id);
      if (chars) signup.characters = chars;
    }
  }
}

/** Fetch overrides for a week range (gracefully degrades if table missing). */
export async function fetchOverrides(
  db: PostgresJsDatabase<typeof schema>,
  userId: number, weekStartDate: string, weekEndDate: string,
): Promise<OverrideRecord[]> {
  try {
    return await db
      .select({ date: schema.gameTimeOverrides.date, hour: schema.gameTimeOverrides.hour, status: schema.gameTimeOverrides.status })
      .from(schema.gameTimeOverrides)
      .where(and(eq(schema.gameTimeOverrides.userId, userId), gte(schema.gameTimeOverrides.date, weekStartDate), lte(schema.gameTimeOverrides.date, weekEndDate)));
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42P01') return [];
    throw err;
  }
}

/** Fetch absences overlapping a week range (gracefully degrades if table missing). */
export async function fetchAbsences(
  db: PostgresJsDatabase<typeof schema>,
  userId: number, weekStartDate: string, weekEndDate: string,
): Promise<AbsenceRecord[]> {
  try {
    return await db
      .select({ id: schema.gameTimeAbsences.id, startDate: schema.gameTimeAbsences.startDate, endDate: schema.gameTimeAbsences.endDate, reason: schema.gameTimeAbsences.reason })
      .from(schema.gameTimeAbsences)
      .where(and(eq(schema.gameTimeAbsences.userId, userId), lte(schema.gameTimeAbsences.startDate, weekEndDate), gte(schema.gameTimeAbsences.endDate, weekStartDate)));
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42P01') return [];
    throw err;
  }
}

/** Build committed slot set from event durations. */
export function buildCommittedSet(
  events: Array<{ duration: [Date, Date] }>,
  weekStart: Date, weekEnd: Date, tzOffset: number,
): Set<string> {
  const committedSet = new Set<string>();
  for (const event of events) {
    const [eventStart, eventEnd] = event.duration;
    const clampedStart = eventStart < weekStart ? weekStart : eventStart;
    const clampedEnd = eventEnd > weekEnd ? weekEnd : eventEnd;
    const cursor = new Date(clampedStart);
    cursor.setUTCMinutes(0, 0, 0);
    if (cursor < clampedStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
    while (cursor < clampedEnd) {
      const localMs = cursor.getTime() - tzOffset * 60 * 1000;
      const localDate = new Date(localMs);
      const weekStartLocalMs = weekStart.getTime() - tzOffset * 60 * 1000;
      const dayDiff = Math.floor((localMs - weekStartLocalMs) / (1000 * 60 * 60 * 24));
      if (dayDiff >= 0 && dayDiff < 7) committedSet.add(`${dayDiff}:${localDate.getUTCHours()}`);
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
  }
  return committedSet;
}

/** Build merged composite slots from template, overrides, absences, and committed events. */
export function buildCompositeSlots(
  templateSlots: Array<{ dayOfWeek: number; hour: number }>,
  templateSet: Set<string>, committedSet: Set<string>,
  absenceDates: Set<string>, overrideMap: Map<string, string>,
  weekStart: Date,
): CompositeSlot[] {
  const slots: CompositeSlot[] = [];
  for (const s of templateSlots) {
    const key = `${s.dayOfWeek}:${s.hour}`;
    const dayDate = new Date(weekStart); dayDate.setDate(dayDate.getDate() + s.dayOfWeek);
    const dateStr = dayDate.toISOString().split('T')[0];
    if (absenceDates.has(dateStr)) { slots.push({ dayOfWeek: s.dayOfWeek, hour: s.hour, status: 'blocked', fromTemplate: true }); }
    else {
      const overrideStatus = overrideMap.get(`${dateStr}:${s.hour}`);
      if (overrideStatus) { slots.push({ dayOfWeek: s.dayOfWeek, hour: s.hour, status: overrideStatus as CompositeSlot['status'], fromTemplate: true }); }
      else { slots.push({ dayOfWeek: s.dayOfWeek, hour: s.hour, status: committedSet.has(key) ? 'committed' : 'available', fromTemplate: true }); }
    }
  }
  for (const key of committedSet) {
    if (!templateSet.has(key)) { const [day, hour] = key.split(':').map(Number); slots.push({ dayOfWeek: day, hour, status: 'committed', fromTemplate: false }); }
  }
  return slots;
}

/** Compute day-of-week to hours mapping for a clamped event duration. */
function computeDayHours(clampedStart: Date, clampedEnd: Date, weekStart: Date, tzOffset: number): Map<number, number[]> {
  const dayHours = new Map<number, number[]>();
  const cursor = new Date(clampedStart); cursor.setUTCMinutes(0, 0, 0);
  if (cursor < clampedStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
  while (cursor < clampedEnd) {
    const localMs = cursor.getTime() - tzOffset * 60 * 1000;
    const localDate = new Date(localMs);
    const dayDiff = Math.floor((localMs - (weekStart.getTime() - tzOffset * 60 * 1000)) / (1000 * 60 * 60 * 24));
    if (dayDiff >= 0 && dayDiff < 7) { const hours = dayHours.get(dayDiff) ?? []; hours.push(localDate.getUTCHours()); dayHours.set(dayDiff, hours); }
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return dayHours;
}

/** Build event block descriptors for the weekly grid. */
export function buildEventBlocks(
  events: SignedUpEventRow[], weekStart: Date, weekEnd: Date, tzOffset: number,
  signupsMap: SignupsPreviewMap,
): EventBlockDescriptor[] {
  const eventBlocks: EventBlockDescriptor[] = [];
  for (const event of events) {
    const [eventStart, eventEnd] = event.duration;
    const clampedStart = eventStart < weekStart ? weekStart : eventStart;
    const clampedEnd = eventEnd > weekEnd ? weekEnd : eventEnd;
    const dayHours = computeDayHours(clampedStart, clampedEnd, weekStart, tzOffset);
    const signupsData = signupsMap.get(event.eventId);
    for (const [dayOfWeek, hours] of dayHours) {
      if (hours.length === 0) continue;
      hours.sort((a, b) => a - b);
      eventBlocks.push({
        eventId: event.eventId, title: event.title, gameSlug: event.gameSlug ?? null, gameName: event.gameName ?? null,
        gameId: event.gameId ?? null, coverUrl: event.gameCoverUrl ?? null, signupId: event.signupId,
        confirmationStatus: event.confirmationStatus as 'pending' | 'confirmed' | 'changed',
        dayOfWeek, startHour: hours[0], endHour: hours[hours.length - 1] + 1,
        description: event.description ?? null, creatorUsername: event.creatorUsername ?? null,
        signupsPreview: signupsData?.preview ?? [], signupCount: signupsData?.count ?? 0,
      });
    }
  }
  return eventBlocks;
}

/** Build absence date set for quick lookup. */
export function buildAbsenceDateSet(
  absences: Array<{ startDate: string; endDate: string }>,
): Set<string> {
  const absenceDates = new Set<string>();
  for (const absence of absences) {
    const start = new Date(absence.startDate);
    const end = new Date(absence.endDate);
    const cursor = new Date(start);
    while (cursor <= end) {
      absenceDates.add(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return absenceDates;
}

/** Assemble the full composite view result from all fetched data. */
export function assembleCompositeView(
  remapped: Array<{ dayOfWeek: number; hour: number }>,
  signedUpEvents: SignedUpEventRow[],
  overrideRows: OverrideRecord[],
  absenceRows: AbsenceRecord[],
  signupsMap: SignupsPreviewMap,
  weekStart: Date, weekEnd: Date, tzOffset: number,
): CompositeViewResult {
  const templateSet = new Set(remapped.map((s) => `${s.dayOfWeek}:${s.hour}`));
  const committedSet = buildCommittedSet(signedUpEvents, weekStart, weekEnd, tzOffset);
  const absenceDates = buildAbsenceDateSet(absenceRows);
  const overrideMap = new Map<string, string>();
  for (const o of overrideRows) overrideMap.set(`${o.date}:${o.hour}`, o.status);

  const slots = buildCompositeSlots(remapped, templateSet, committedSet, absenceDates, overrideMap, weekStart);
  const events = buildEventBlocks(signedUpEvents, weekStart, weekEnd, tzOffset, signupsMap);

  return { slots, events, weekStart: weekStart.toISOString(), overrides: overrideRows, absences: absenceRows };
}
