/**
 * Fixtures + response contracts for the ROK-1463 LFG read endpoints.
 *
 * Kept SEPARATE from `lfg.integration.spec-helpers.ts` (ROK-1451's fixtures,
 * already ~215 counted lines) rather than growing that file. Import from both.
 *
 * TDD NOTE — same rule as the sibling helper file: nothing here imports from
 * `./lfg.*`. The spec must stay COMPILABLE before the implementation exists so
 * each test fails on its own real assertion (404 on a route Nest does not know)
 * instead of the whole file dying on module resolution. That includes the
 * caps/horizon below: they are local copies of the values `lfg.constants.ts`
 * must export, and `lfg-overlap.helpers.spec.ts` is what pins the real exports.
 *
 * TIMEZONE — these fixtures write through drizzle (see the note at
 * `lfg.integration.spec-helpers.ts:176-186`). `game_time_overrides.date` and
 * `game_time_absences.start_date` are `date` columns and take `YYYY-MM-DD`
 * strings; `availability.time_range` is a `tsrange` of naive timestamps whose
 * custom type serialises via `toISOString()`, so every Date handed in must
 * already be the UTC instant you mean. Run the spec with `TZ=UTC`.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { type TestApp } from '../common/testing/test-app';

// ─── Values the implementation must export from `lfg.constants.ts` ──────────

/** Days of grid the overlap read projects forward from now. */
export const OVERLAP_HORIZON_DAYS = 14;
/** Hard cap on returned overlap windows. */
export const OVERLAP_WINDOW_CAP = 2;
/** Hard cap on history entries. */
export const HISTORY_CAP = 20;
/** Hard cap on suggested players. */
export const SUGGESTIONS_CAP = 12;

export const HOUR_MS = 60 * 60 * 1000;

/**
 * An ISO-8601 instant that carries an explicit offset (`Z` or `±HH:MM`).
 * `start` must be seedable straight into `SuggestSlotSchema.proposedTime`, so a
 * naive `2026-09-10T19:00:00` (no offset) is NOT acceptable.
 */
export const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/;

// ─── Response contracts (the DTO shape this story is built against) ─────────

export interface LfgOverlapWindowDto {
  start: string;
  end: string;
  availableCount: number;
  totalCount: number;
  members: number[];
}

export interface LfgOverlapResponseDto {
  gameId: number;
  memberCount: number;
  horizonDays: number;
  windows: LfgOverlapWindowDto[];
}

export interface LfgHistoryEntryDto {
  eventId: number;
  title: string;
  isAdHoc: boolean;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  attendedCount: number;
  signedUpCount: number;
  participantIds: number[];
}

export interface LfgHistoryResponseDto {
  gameId: number;
  entries: LfgHistoryEntryDto[];
}

export type LfgSuggestionReason = 'played' | 'owns' | 'hearted';

export interface LfgSuggestionDto {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  reasons: LfgSuggestionReason[];
  lastPlayedAt: string | null;
}

export interface LfgSuggestionsResponseDto {
  gameId: number;
  suggestions: LfgSuggestionDto[];
}

// ─── UTC date arithmetic ────────────────────────────────────────────────────

/** Midnight UTC, `days` from today. */
export function utcDayOffset(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** The `YYYY-MM-DD` a `date` column stores for this instant, in UTC. */
export function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The instant at `hour:00:00.000` UTC on the given day. */
export function atUtcHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/**
 * Day index in the `game_time_templates` convention: **0 = Monday**, 6 = Sunday
 * (`game-time-templates.ts:26`). Note this is NOT the events-schema convention
 * (`events.schema.ts:306`, 0 = Sunday) — the two disagree, and the grid is the
 * one that governs here.
 */
export function gridDayOfWeek(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Window start instants as epoch ms — offset-format agnostic comparisons. */
export function windowStarts(windows: LfgOverlapWindowDto[]): number[] {
  return windows.map((w) => new Date(w.start).getTime());
}

/** Ascending numeric comparator for `members` / id arrays. */
export const byId = (a: number, b: number): number => a - b;

// ─── Fixtures ───────────────────────────────────────────────────────────────

let plainUserSeq = 0;

/**
 * Create a user WITHOUT local credentials or a login round-trip.
 *
 * Most rows these reads look at (attendees, owners, hearters) never need a
 * token; `createMemberAndLogin` costs a bcrypt hash plus an HTTP login each
 * time, which is wasted work at cap-sized fixtures (12–21 users).
 */
export async function createPlainUser(
  testApp: TestApp,
  username: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  plainUserSeq += 1;
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `plain:${username}:${plainUserSeq}`,
      username: `${username}-${plainUserSeq}`,
      role: 'member',
      ...overrides,
    })
    .returning();
  return user.id;
}

/**
 * Replace a user's recurring grid for one weekday.
 *
 * @param dayOfWeek - 0 = Monday (see {@link gridDayOfWeek}).
 * @param hours - `start_hour` values (0–23). An empty list clears the day.
 */
export async function setGameTimeTemplate(
  testApp: TestApp,
  userId: number,
  dayOfWeek: number,
  hours: number[],
): Promise<void> {
  await testApp.db
    .delete(schema.gameTimeTemplates)
    .where(
      and(
        eq(schema.gameTimeTemplates.userId, userId),
        eq(schema.gameTimeTemplates.dayOfWeek, dayOfWeek),
      ),
    );
  if (hours.length === 0) return;
  await testApp.db
    .insert(schema.gameTimeTemplates)
    .values(hours.map((startHour) => ({ userId, dayOfWeek, startHour })));
}

/**
 * Pin one date-specific hour, overriding the recurring template.
 *
 * @param dateIso - `YYYY-MM-DD` (see {@link utcDateOnly}).
 * @param status - `'available'` or `'blocked'`.
 */
export async function setGameTimeOverride(
  testApp: TestApp,
  userId: number,
  dateIso: string,
  hour: number,
  status: 'available' | 'blocked',
): Promise<void> {
  await testApp.db
    .insert(schema.gameTimeOverrides)
    .values({ userId, date: dateIso, hour, status })
    .onConflictDoUpdate({
      target: [
        schema.gameTimeOverrides.userId,
        schema.gameTimeOverrides.date,
        schema.gameTimeOverrides.hour,
      ],
      set: { status },
    });
}

/**
 * Block a whole inclusive date range for a user (travel / vacation).
 * Absences outrank both the template and per-hour overrides.
 */
export async function addAbsence(
  testApp: TestApp,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<void> {
  await testApp.db
    .insert(schema.gameTimeAbsences)
    .values({ userId, startDate, endDate, reason: 'integration fixture' });
}

/**
 * Insert a tsrange `availability` row — the thin ROK-112 table layered on top
 * of the grid (`available` adds hours, `blocked` / `committed` remove them).
 *
 * @param gameId - Optional game scope (`availability.game_id`). Null/omitted
 *   means "all games"; a value scopes the row to that ONE game (ROK-400).
 */
export async function addAvailabilityRange(
  testApp: TestApp,
  userId: number,
  startIso: string,
  endIso: string,
  status: 'available' | 'committed' | 'blocked' | 'freed',
  gameId: number | null = null,
): Promise<void> {
  await testApp.db.insert(schema.availability).values({
    userId,
    timeRange: [new Date(startIso), new Date(endIso)] as [Date, Date],
    status,
    gameId,
  });
}

/**
 * Record a post-event attendance for an existing signup (ROK-421).
 * The signup must already exist — pair with `signupViaDb`.
 */
export async function markAttended(
  testApp: TestApp,
  eventId: number,
  userId: number,
): Promise<void> {
  return markAttendance(testApp, eventId, userId, 'attended');
}

/**
 * Record ANY post-event attendance outcome (ROK-421 vocabulary:
 * `attended` / `no_show` / `excused`). A non-`attended` value still means
 * attendance WAS taken, which is the distinction the history read makes.
 */
export async function markAttendance(
  testApp: TestApp,
  eventId: number,
  userId: number,
  status: 'attended' | 'no_show' | 'excused',
): Promise<void> {
  const rows = await testApp.db
    .update(schema.eventSignups)
    .set({ attendanceStatus: status, attendanceRecordedAt: new Date() })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .returning({ id: schema.eventSignups.id });
  if (rows.length === 0) {
    throw new Error(
      `markAttendance: no signup for user ${userId} on event ${eventId} — call signupViaDb first`,
    );
  }
}

/**
 * Set the `show_activity` privacy preference (`PRIVACY_FILTER` in
 * `igdb-activity.helpers.ts` treats a jsonb `false` as opted out).
 */
export async function setShowActivity(
  testApp: TestApp,
  userId: number,
  enabled: boolean,
): Promise<void> {
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'show_activity', value: enabled })
    .onConflictDoUpdate({
      target: [schema.userPreferences.userId, schema.userPreferences.key],
      set: { value: enabled },
    });
}

// ─── Timezone fixtures + oracles (C1) ───────────────────────────────────────

/**
 * Set a user's IANA timezone preference — the zone the game-time grid's
 * wall-clock hours are written in (`user_preferences.key = 'timezone'`, read
 * back by `resolveUserTimezones`).
 */
export async function setUserTimezone(
  testApp: TestApp,
  userId: number,
  timeZone: string,
): Promise<void> {
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'timezone', value: timeZone })
    .onConflictDoUpdate({
      target: [schema.userPreferences.userId, schema.userPreferences.key],
      set: { value: timeZone },
    });
}

/** The wall-clock date + hour an instant reads as in a given zone. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // `hour12: false` renders midnight as `24` in some ICU versions.
    hour: Number(get('hour')) % 24,
  };
}

/**
 * The UTC instant whose wall clock in `timeZone` is `dateStr` at `hour`.
 *
 * Deliberately a SEARCH over {@link zonedParts} rather than offset arithmetic:
 * the point of the C1 tests is to check the implementation's conversion, so
 * the oracle must not be a second copy of it.
 */
export function instantOfLocalHour(
  dateStr: string,
  hour: number,
  timeZone: string,
): Date {
  const noonUtc = Date.parse(`${dateStr}T12:00:00Z`);
  for (let deltaHours = -15; deltaHours <= 15; deltaHours += 1) {
    const candidate = new Date(noonUtc + (hour - 12 + deltaHours) * HOUR_MS);
    const parts = zonedParts(candidate, timeZone);
    if (parts.date === dateStr && parts.hour === hour) return candidate;
  }
  throw new Error(`No instant for ${dateStr} ${hour}:00 in ${timeZone}`);
}

/**
 * Record that the user explicitly un-hearted the game (ROK-444). The daily
 * auto-heart cron skips the pair afterwards; it is NOT a statement about the
 * Steam library.
 */
export async function suppressInterest(
  testApp: TestApp,
  userId: number,
  gameId: number,
): Promise<void> {
  await testApp.db
    .insert(schema.gameInterestSuppressions)
    .values({ userId, gameId })
    .onConflictDoNothing();
}
