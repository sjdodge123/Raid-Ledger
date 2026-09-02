/**
 * Database -> per-member hour sets for `GET /lfg/:gameId/overlap` (ROK-1463 §A).
 *
 * Operator decision D7: the source of truth is the recurring **game-time grid**
 * (`game_time_templates` + `game_time_overrides` + `game_time_absences`), which
 * is what players actually fill in, with the thin tsrange `availability` table
 * (ROK-112) layered on top rather than used alone.
 *
 * This file is the DB half: four roster-wide queries plus the member timezone
 * resolution. The arithmetic that turns those rows into instants lives in
 * `lfg-grid-projection.helpers.ts` / `lfg-zoned-time.helpers.ts`.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import type { LfgOverlapResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { resolveUserTimezones } from '../notifications/timezone.helpers';
import { listGroupMembers, type LfgDb } from './lfg-query.helpers';
import { LFG_OVERLAP_HORIZON_DAYS } from './lfg.constants';
import { computeOverlapWindows, type MemberSlots } from './lfg-overlap.helpers';
import {
  applyRanges,
  buildBaseSlots,
  indexGrid,
  zonedDayResolver,
  type GridRows,
  type OverlapHorizon,
} from './lfg-grid-projection.helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type { OverlapHorizon };

/**
 * The window the read projects: from the next whole hour to `days` from now.
 *
 * Rounding the start UP means an hour already under way is never offered as a
 * window the group could still schedule into.
 *
 * @param now - Instant the horizon is measured from.
 * @param days - Horizon length. Defaults to {@link LFG_OVERLAP_HORIZON_DAYS}.
 */
export function buildHorizon(
  now: Date,
  days: number = LFG_OVERLAP_HORIZON_DAYS,
): OverlapHorizon {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  if (start.getTime() < now.getTime()) {
    start.setTime(start.getTime() + HOUR_MS);
  }
  return { start, end: new Date(now.getTime() + days * DAY_MS) };
}

/** The `YYYY-MM-DD` bounds the `date`-typed grid tables are filtered on. */
interface DateBounds {
  first: string;
  last: string;
}

/**
 * Date bounds widened by a day on each side: the grid's dates are LOCAL
 * calendar days, and no zone is more than 14 hours from UTC, so a member's
 * first/last local day can sit outside the horizon's own UTC dates.
 */
function dateBounds(horizon: OverlapHorizon): DateBounds {
  const asDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return {
    first: asDate(horizon.start.getTime() - DAY_MS),
    last: asDate(horizon.end.getTime() + DAY_MS),
  };
}

/** Recurring weekly grid rows for the whole roster. */
function fetchTemplates(db: LfgDb, memberIds: number[]) {
  return db
    .select({
      userId: schema.gameTimeTemplates.userId,
      dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
      startHour: schema.gameTimeTemplates.startHour,
    })
    .from(schema.gameTimeTemplates)
    .where(inArray(schema.gameTimeTemplates.userId, memberIds));
}

/** Date-specific hour overrides landing inside the horizon. */
function fetchOverrides(db: LfgDb, memberIds: number[], bounds: DateBounds) {
  return db
    .select({
      userId: schema.gameTimeOverrides.userId,
      date: schema.gameTimeOverrides.date,
      hour: schema.gameTimeOverrides.hour,
      status: schema.gameTimeOverrides.status,
    })
    .from(schema.gameTimeOverrides)
    .where(
      and(
        inArray(schema.gameTimeOverrides.userId, memberIds),
        gte(schema.gameTimeOverrides.date, bounds.first),
        lte(schema.gameTimeOverrides.date, bounds.last),
      ),
    );
}

/** Absences whose inclusive range intersects the horizon. */
function fetchAbsences(db: LfgDb, memberIds: number[], bounds: DateBounds) {
  return db
    .select({
      userId: schema.gameTimeAbsences.userId,
      startDate: schema.gameTimeAbsences.startDate,
      endDate: schema.gameTimeAbsences.endDate,
    })
    .from(schema.gameTimeAbsences)
    .where(
      and(
        inArray(schema.gameTimeAbsences.userId, memberIds),
        lte(schema.gameTimeAbsences.startDate, bounds.last),
        gte(schema.gameTimeAbsences.endDate, bounds.first),
      ),
    );
}

/**
 * ROK-112 tsrange rows overlapping the horizon. `&&` is the range-overlap
 * operator, which the GiST index on `time_range` serves. `game_id` comes back
 * with the row: it scopes the ADDITIVE pass only (see `applyRanges`).
 */
function fetchRanges(db: LfgDb, memberIds: number[], horizon: OverlapHorizon) {
  const rangeStr = `[${horizon.start.toISOString()},${horizon.end.toISOString()})`;
  return db
    .select({
      userId: schema.availability.userId,
      timeRange: schema.availability.timeRange,
      status: schema.availability.status,
      gameId: schema.availability.gameId,
    })
    .from(schema.availability)
    .where(
      and(
        inArray(schema.availability.userId, memberIds),
        sql`${schema.availability.timeRange} && ${rangeStr}::tsrange`,
      ),
    );
}

/**
 * Fetch every row the projection needs — four queries for the whole roster,
 * never one per member.
 */
async function fetchGridRows(
  db: LfgDb,
  memberIds: number[],
  horizon: OverlapHorizon,
): Promise<GridRows> {
  const bounds = dateBounds(horizon);
  const [templates, overrides, absences, ranges] = await Promise.all([
    fetchTemplates(db, memberIds),
    fetchOverrides(db, memberIds, bounds),
    fetchAbsences(db, memberIds, bounds),
    fetchRanges(db, memberIds, horizon),
  ]);
  return { templates, overrides, absences, ranges };
}

/**
 * Resolve the roster's availability into one hour-set per member.
 *
 * @param db - Drizzle handle.
 * @param memberIds - Live roster. Every id gets an entry, possibly empty — the
 *   ranking helpers derive the roster size from the map, so a member with no
 *   grid must still be present.
 * @param gameId - Game being read; scopes `available` tsrange rows (W2).
 * @param options - `now` (horizon origin), `days` (horizon length) and
 *   `defaultTimeZone` (the community zone a member with no preference falls
 *   back to).
 * @returns userId -> set of hour-start ISO instants.
 */
export async function loadMemberSlots(
  db: LfgDb,
  memberIds: number[],
  gameId: number,
  options: { now: Date; days?: number; defaultTimeZone?: string },
): Promise<MemberSlots> {
  if (memberIds.length === 0) return new Map();
  const horizon = buildHorizon(options.now, options.days);
  const [rows, zones] = await Promise.all([
    fetchGridRows(db, memberIds, horizon),
    resolveUserTimezones(db, memberIds, options.defaultTimeZone ?? 'UTC'),
  ]);
  const daysOf = zonedDayResolver(zones, horizon);
  const slots = buildBaseSlots(zones, daysOf, indexGrid(rows, daysOf), horizon);
  applyRanges(slots, rows.ranges, horizon, gameId);
  return slots;
}

/**
 * `GET /lfg/:gameId/overlap` — resolve the live roster, project its grid and
 * rank the best windows.
 *
 * The caller has already 404'd an unknown game; a game nobody is looking for
 * is a valid read that answers with an empty `windows`.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose LFG group to project.
 * @param defaultTimeZone - `app_settings.default_timezone`, used for members
 *   who never set one of their own.
 * @returns The wire response, windows capped at {@link LFG_OVERLAP_WINDOWS}.
 */
export async function buildOverlapResponse(
  db: LfgDb,
  gameId: number,
  defaultTimeZone: string,
): Promise<LfgOverlapResponseDto> {
  const members = await listGroupMembers(db, gameId);
  const slots = await loadMemberSlots(
    db,
    members.map((m) => m.userId),
    gameId,
    { now: new Date(), defaultTimeZone },
  );
  return {
    gameId,
    memberCount: members.length,
    horizonDays: LFG_OVERLAP_HORIZON_DAYS,
    windows: computeOverlapWindows(slots),
  };
}
