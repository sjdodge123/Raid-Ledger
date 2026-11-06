/**
 * Composite-view assembly for GameTimeService.getCompositeView.
 * Extracted from game-time.service.ts for file size compliance; the
 * service keeps the cache get/set and delegates the build here.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  fetchWeekSignedUpEvents,
  fetchSignupsPreview,
  fetchOverrides,
  fetchAbsences,
  assembleCompositeView,
  eventWeekWindow,
} from './game-time-composite.helpers';
import {
  gameTimeAgeDays,
  isGameTimeStale,
} from './game-time-freshness.helpers';
import { fetchGameTimeConfirmedAt } from './game-time-confirmation.helpers';
import type { TemplateSlot, CompositeViewResult } from './game-time.types';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Reads a user's raw template; the service passes its own `getTemplate`. */
export type TemplateReader = (
  userId: number,
) => Promise<{ slots: TemplateSlot[] }>;

/** Compute week date range strings for override/absence queries. */
function weekDateRange(weekStart: Date, weekEnd: Date): [string, string] {
  return [
    defined(weekStart.toISOString().split('T')[0], 'week start date'),
    defined(
      new Date(weekEnd.getTime() - 1).toISOString().split('T')[0],
      'week end date',
    ),
  ];
}

/**
 * Freshness fields on the composite view: whether the schedule is stale
 * (ROK-999) and how many days old the confirmation is (ROK-1564).
 */
function freshnessFields(confirmedAt: Date | null): {
  gameTimeStale: boolean;
  gameTimeAgeDays: number | null;
} {
  return {
    gameTimeStale: isGameTimeStale(confirmedAt),
    gameTimeAgeDays: gameTimeAgeDays(confirmedAt),
  };
}

/** Template days are Monday-first; the composite week is Sunday-first. */
function remapToSundayFirst(slots: TemplateSlot[]): TemplateSlot[] {
  return slots.map((s) => ({ ...s, dayOfWeek: (s.dayOfWeek + 1) % 7 }));
}

/** The rendered week plus the shifted window events are read from. */
interface CompositeRange {
  weekStart: Date;
  weekEnd: Date;
  eventWindow: [Date, Date];
}

/** One shifted window for the event fetch, committed slots and blocks. */
function compositeRange(
  weekStart: Date,
  tzOffset: number,
  weekSent: boolean,
): CompositeRange {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const eventWindow = eventWeekWindow(weekStart, weekEnd, tzOffset, weekSent);
  return { weekStart, weekEnd, eventWindow };
}

/** Fetch all data sources for composite view in parallel (including template). */
function fetchAllCompositeData(
  db: Db,
  getTemplate: TemplateReader,
  userId: number,
  { weekStart, weekEnd, eventWindow }: CompositeRange,
) {
  const [startDate, endDate] = weekDateRange(weekStart, weekEnd);
  return Promise.all([
    getTemplate(userId),
    fetchWeekSignedUpEvents(db, userId, ...eventWindow),
    fetchOverrides(db, userId, startDate, endDate),
    fetchAbsences(db, userId, startDate, endDate),
    fetchGameTimeConfirmedAt(db, userId),
  ]);
}

/** Build the composite result from all data sources. */
export async function buildCompositeViewResult(
  db: Db,
  getTemplate: TemplateReader,
  userId: number,
  weekStart: Date,
  tzOffset: number,
  weekSent = true,
): Promise<CompositeViewResult> {
  const range = compositeRange(weekStart, tzOffset, weekSent);
  const [template, signedUpEvents, overrideRows, absenceRows, confirmedAt] =
    await fetchAllCompositeData(db, getTemplate, userId, range);
  const remapped = remapToSundayFirst(template.slots);
  const signupsMap = await fetchSignupsPreview(db, [
    ...new Set(signedUpEvents.map((e) => e.eventId)),
  ]);
  const view = assembleCompositeView(
    remapped,
    signedUpEvents,
    overrideRows,
    absenceRows,
    signupsMap,
    weekStart,
    range.weekEnd,
    tzOffset,
    range.eventWindow,
  );
  return { ...view, ...freshnessFields(confirmedAt) };
}
