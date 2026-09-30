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
} from './game-time-composite.helpers';
import {
  gameTimeAgeDays,
  isGameTimeStale,
} from './game-time-freshness.helpers';
import { fetchGameTimeConfirmedAt } from './game-time-confirmation.helpers';
import type { TemplateSlot, CompositeViewResult } from './game-time.types';

type Db = PostgresJsDatabase<typeof schema>;

/** Reads a user's raw template; the service passes its own `getTemplate`. */
export type TemplateReader = (
  userId: number,
) => Promise<{ slots: TemplateSlot[] }>;

/** Compute week date range strings for override/absence queries. */
function weekDateRange(weekStart: Date, weekEnd: Date): [string, string] {
  return [
    weekStart.toISOString().split('T')[0],
    new Date(weekEnd.getTime() - 1).toISOString().split('T')[0],
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

/** Fetch all data sources for composite view in parallel (including template). */
function fetchAllCompositeData(
  db: Db,
  getTemplate: TemplateReader,
  userId: number,
  weekStart: Date,
  weekEnd: Date,
) {
  const [startDate, endDate] = weekDateRange(weekStart, weekEnd);
  return Promise.all([
    getTemplate(userId),
    fetchWeekSignedUpEvents(db, userId, weekStart, weekEnd),
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
): Promise<CompositeViewResult> {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const [template, signedUpEvents, overrideRows, absenceRows, confirmedAt] =
    await fetchAllCompositeData(db, getTemplate, userId, weekStart, weekEnd);
  const remapped = template.slots.map((s) => ({
    ...s,
    dayOfWeek: (s.dayOfWeek + 1) % 7,
  }));
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
    weekEnd,
    tzOffset,
  );
  return { ...view, ...freshnessFields(confirmedAt) };
}
