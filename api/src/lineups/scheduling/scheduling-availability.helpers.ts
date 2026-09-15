/**
 * Availability helpers for scheduling poll heatmap (ROK-965).
 * Builds aggregate game-time cells from templates for match members.
 * Returns AggregateGameTimeResponse shape for GameTimeGrid's heatmapOverlay.
 *
 * ROK-1560: cells now carry a fresh / stale / unknown split — fill = fresh
 * availability, hatch = stale, `unknownCount` = members with no template at
 * all. A stale member is never counted as available.
 *
 * ROK-1570: the aggregate is painted for ONE dated week and a member's active
 * event signups and absences in that week are subtracted from their templates
 * first, so the heatmap can no longer show someone free at an hour they are
 * already committed to. A busy member is busy, not unknown — they still have a
 * template, so `unknownCount` / `untemplatedMembers` do not move.
 *
 * ROK-1570 (review): the subtraction is done in the VIEWER'S local clock —
 * `tzOffset` (browser `getTimezoneOffset()` minutes, default 0 = UTC) is
 * threaded down to `fetchBusyKeys`; see that file's header for the contract.
 * A cell every templated member is busy at is re-emitted with
 * `availableCount: 0` rather than vanishing from `cells`.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import {
  GAME_TIME_FRESHNESS_DAYS,
  gameTimeAgeDays,
  isGameTimeStale,
} from '../../users/game-time-freshness.helpers';
import { templateDayToGridDay } from '../../users/game-time-heatmap.helpers';
import {
  splitMembersByFreshness,
  aggregateFreshnessCells,
  type FreshnessSplit,
} from './scheduling-availability-freshness.helpers';
import {
  busyKey,
  fetchBusyKeys,
  withFullyBusyCells,
} from './scheduling-availability-busy.helpers';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Db = PostgresJsDatabase<typeof schema>;

interface TemplateRow {
  userId: number;
  dayOfWeek: number;
  startHour: number;
}

/** Fetch game time templates for given user IDs. */
async function fetchTemplates(
  db: Db,
  userIds: number[],
): Promise<TemplateRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: schema.gameTimeTemplates.userId,
      dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
      startHour: schema.gameTimeTemplates.startHour,
    })
    .from(schema.gameTimeTemplates)
    .where(inArray(schema.gameTimeTemplates.userId, userIds));
}

/** Fetch `users.game_time_confirmed_at` for the given user IDs (ROK-1560). */
async function fetchConfirmedAt(
  db: Db,
  userIds: number[],
): Promise<Map<number, Date | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: schema.users.id,
      confirmedAt: schema.users.gameTimeConfirmedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(rows.map((r) => [r.userId, r.confirmedAt ?? null]));
}

/**
 * Whole days since the viewer last confirmed game time. `null` = never
 * confirmed; `undefined` = no viewer in this request (keeps the contract's
 * `null` meaning unambiguous).
 */
function viewerAge(
  confirmed: Map<number, Date | null>,
  viewerUserId: number | undefined,
  now: Date,
): number | null | undefined {
  if (!viewerUserId) return undefined;
  return gameTimeAgeDays(confirmed.get(viewerUserId) ?? null, now);
}

/** The server's stale verdict for the viewer — the same rule the fill uses. */
function viewerStale(
  confirmed: Map<number, Date | null>,
  viewerUserId: number | undefined,
  now: Date,
): boolean | undefined {
  if (!viewerUserId) return undefined;
  return isGameTimeStale(confirmed.get(viewerUserId) ?? null, now);
}

/** Empty heatmap for a poll with no members — still reports viewer freshness. */
async function emptyAvailability(
  db: Db,
  matchId: number,
  viewerUserId: number | undefined,
  now: Date,
): Promise<AggregateGameTimeResponse> {
  const confirmed = await fetchConfirmedAt(
    db,
    viewerUserId ? [viewerUserId] : [],
  );
  return {
    eventId: matchId,
    totalUsers: 0,
    cells: [],
    totalMembers: 0,
    freshnessDays: GAME_TIME_FRESHNESS_DAYS,
    untemplatedMembers: 0,
    viewerGameTimeAgeDays: viewerAge(confirmed, viewerUserId, now),
    viewerGameTimeStale: viewerStale(confirmed, viewerUserId, now),
  };
}

/** Pair each member id with their confirmation timestamp and template presence. */
function toFreshnessMembers(
  memberUserIds: number[],
  templates: TemplateRow[],
  confirmed: Map<number, Date | null>,
) {
  const templated = new Set(templates.map((t) => t.userId));
  return memberUserIds.map((userId) => ({
    userId,
    confirmedAt: confirmed.get(userId) ?? null,
    hasTemplate: templated.has(userId),
  }));
}

/**
 * Sunday 00:00 UTC of the week containing `now` — grid day 0 is Sunday, so the
 * default week the heatmap describes starts there.
 *
 * Exported (ROK-1570) so the controller's `?weekStart=` parsing normalises with
 * the SAME rule the default uses; a second implementation would drift.
 *
 * @param now - Any instant.
 * @returns Sunday 00:00:00.000 UTC of that instant's week.
 */
export function startOfWeekUtc(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

/**
 * Drop template rows whose member is already committed at that grid cell, so
 * the member is counted neither available nor stale there. The DB -> grid day
 * remap lives here only; `busy` keys are already grid convention.
 */
function subtractBusy(
  templates: TemplateRow[],
  busy: Map<number, Set<string>>,
): TemplateRow[] {
  if (busy.size === 0) return templates;
  return templates.filter((t) => {
    const key = busyKey(templateDayToGridDay(t.dayOfWeek), t.startHour);
    return !busy.get(t.userId)?.has(key);
  });
}

/**
 * The week's cells: templates minus the hours their member is committed to,
 * plus a zeroed cell for every template key the subtraction emptied — a cell
 * everyone is busy at is information (`0 free`), not missing data.
 */
function buildCells(
  templates: TemplateRow[],
  split: FreshnessSplit,
  busy: Map<number, Set<string>>,
  totalMembers: number,
): AggregateGameTimeResponse['cells'] {
  const free = subtractBusy(templates, busy);
  return withFullyBusyCells(
    aggregateFreshnessCells(free, split, totalMembers),
    templates,
    split.untemplatedIds.length,
    totalMembers,
  );
}

/**
 * Templates, confirmations and the week's busy hours — all independent, so one
 * round trip. Confirmations also cover the viewer, who need not be a member.
 */
function loadInputs(
  db: Db,
  memberUserIds: number[],
  week: Date,
  viewerUserId: number | undefined,
  tzOffset: number,
): Promise<
  [TemplateRow[], Map<number, Date | null>, Map<number, Set<string>>]
> {
  const lookupIds = Array.from(
    new Set(viewerUserId ? [...memberUserIds, viewerUserId] : memberUserIds),
  );
  return Promise.all([
    fetchTemplates(db, memberUserIds),
    fetchConfirmedAt(db, lookupIds),
    fetchBusyKeys(
      db,
      memberUserIds,
      week,
      new Date(week.getTime() + WEEK_MS),
      tzOffset,
    ),
  ]);
}

/**
 * Build aggregate game-time availability for match members.
 * Returns shape compatible with GameTimeGrid's heatmapOverlay prop.
 * Templates and confirmations are independent and fetched concurrently.
 *
 * @param weekStart - Calendar Sunday 00:00 UTC of the week to paint; defaults
 *   to the current one.
 * @param tzOffset - Viewer `getTimezoneOffset()` minutes; 0 (default) = UTC.
 */
export async function buildSchedulingAvailability(
  db: Db,
  memberUserIds: number[],
  matchId: number,
  viewerUserId?: number,
  weekStart?: Date,
  tzOffset = 0,
): Promise<AggregateGameTimeResponse> {
  const now = new Date();
  if (memberUserIds.length === 0) {
    return emptyAvailability(db, matchId, viewerUserId, now);
  }
  const week = weekStart ?? startOfWeekUtc(now);
  const [templates, confirmed, busy] = await loadInputs(
    db,
    memberUserIds,
    week,
    viewerUserId,
    tzOffset,
  );
  // Freshness is measured on the FULL template set: a busy member still has a
  // template, so subtracting their committed hours must not make them unknown.
  const members = toFreshnessMembers(memberUserIds, templates, confirmed);
  const split = splitMembersByFreshness(members, now);
  const cells = buildCells(templates, split, busy, memberUserIds.length);
  return {
    weekStart: week.toISOString(),
    eventId: matchId,
    totalUsers: memberUserIds.length,
    cells,
    totalMembers: memberUserIds.length,
    freshnessDays: GAME_TIME_FRESHNESS_DAYS,
    untemplatedMembers: split.untemplatedIds.length,
    viewerGameTimeAgeDays: viewerAge(confirmed, viewerUserId, now),
    viewerGameTimeStale: viewerStale(confirmed, viewerUserId, now),
  };
}
