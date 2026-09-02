/**
 * Database -> per-member hour sets for `GET /lfg/:gameId/overlap` (ROK-1463 §A).
 *
 * Operator decision D7: the source of truth is the recurring **game-time grid**
 * (`game_time_templates` + `game_time_overrides` + `game_time_absences`), which
 * is what players actually fill in, with the thin tsrange `availability` table
 * (ROK-112) layered on top rather than used alone.
 *
 * DAY-OF-WEEK CONVENTION — `game_time_templates.day_of_week` is **0 = Monday**
 * (`game-time-templates.ts:26`), which disagrees with `events.schema.ts:306`
 * (0 = Sunday). This module is the one place the grid convention is read, and
 * {@link gridDayOfWeek} is the only place the mapping lives. Everything else
 * here works in concrete UTC instants, so the ambiguity cannot leak outward.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import type { LfgOverlapResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { listGroupMembers, type LfgDb } from './lfg-query.helpers';
import { LFG_OVERLAP_HORIZON_DAYS } from './lfg.constants';
import { computeOverlapWindows, type MemberSlots } from './lfg-overlap.helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Half-open `[start, end)` instants the overlap read projects over. */
export interface OverlapHorizon {
  start: Date;
  end: Date;
}

/** One UTC calendar day inside the horizon. */
interface HorizonDay {
  /** `YYYY-MM-DD`, as the `date` columns store it. */
  dateStr: string;
  /** 0 = Monday (the `game_time_templates` convention). */
  dayOfWeek: number;
  /** Epoch ms at 00:00 UTC. */
  startMs: number;
}

/** Day index in the grid's own convention: 0 = Monday, 6 = Sunday. */
export function gridDayOfWeek(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

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

/** Every UTC day the horizon touches, oldest first. */
export function enumerateDays(horizon: OverlapHorizon): HorizonDay[] {
  const days: HorizonDay[] = [];
  const cursor = new Date(horizon.start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < horizon.end.getTime()) {
    days.push({
      dateStr: cursor.toISOString().slice(0, 10),
      dayOfWeek: gridDayOfWeek(cursor),
      startMs: cursor.getTime(),
    });
    cursor.setTime(cursor.getTime() + DAY_MS);
  }
  return days;
}

/** Raw grid + availability rows for the whole roster, fetched in one round. */
interface GridRows {
  templates: { userId: number; dayOfWeek: number; startHour: number }[];
  overrides: { userId: number; date: string; hour: number; status: string }[];
  absences: { userId: number; startDate: string; endDate: string }[];
  ranges: { userId: number; timeRange: [Date, Date]; status: string }[];
}

/** The `YYYY-MM-DD` bounds the `date`-typed grid tables are filtered on. */
interface DateBounds {
  first: string;
  last: string;
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
 * operator, which the GiST index on `time_range` serves.
 */
function fetchRanges(db: LfgDb, memberIds: number[], horizon: OverlapHorizon) {
  const rangeStr = `[${horizon.start.toISOString()},${horizon.end.toISOString()})`;
  return db
    .select({
      userId: schema.availability.userId,
      timeRange: schema.availability.timeRange,
      status: schema.availability.status,
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
  const bounds: DateBounds = {
    first: horizon.start.toISOString().slice(0, 10),
    last: new Date(horizon.end.getTime() - 1).toISOString().slice(0, 10),
  };
  const [templates, overrides, absences, ranges] = await Promise.all([
    fetchTemplates(db, memberIds),
    fetchOverrides(db, memberIds, bounds),
    fetchAbsences(db, memberIds, bounds),
    fetchRanges(db, memberIds, horizon),
  ]);
  return { templates, overrides, absences, ranges };
}

/** Lookup tables keyed for the per-day projection below. */
interface GridIndex {
  /** `userId:dayOfWeek` -> recurring template hours. */
  templates: Map<string, number[]>;
  /** `userId:YYYY-MM-DD` -> hour -> `'available' | 'blocked'`. */
  overrides: Map<string, Map<number, string>>;
  /** userId -> `YYYY-MM-DD` days wholly blocked by an absence. */
  absences: Map<number, Set<string>>;
}

/** Expand an inclusive absence range into date strings, clamped to the days. */
function absenceDates(
  row: { startDate: string; endDate: string },
  days: HorizonDay[],
): string[] {
  return days
    .filter((d) => d.dateStr >= row.startDate && d.dateStr <= row.endDate)
    .map((d) => d.dateStr);
}

/** Build the lookup tables the per-day projection reads. */
function indexGrid(rows: GridRows, days: HorizonDay[]): GridIndex {
  const index: GridIndex = {
    templates: new Map(),
    overrides: new Map(),
    absences: new Map(),
  };
  for (const t of rows.templates) {
    const key = `${t.userId}:${t.dayOfWeek}`;
    const hours = index.templates.get(key);
    if (hours) hours.push(t.startHour);
    else index.templates.set(key, [t.startHour]);
  }
  for (const o of rows.overrides) {
    const key = `${o.userId}:${o.date}`;
    const byHour = index.overrides.get(key) ?? new Map<number, string>();
    byHour.set(o.hour, o.status);
    index.overrides.set(key, byHour);
  }
  for (const a of rows.absences) {
    const dates = index.absences.get(a.userId) ?? new Set<string>();
    for (const date of absenceDates(a, days)) dates.add(date);
    index.absences.set(a.userId, dates);
  }
  return index;
}

/**
 * Hours a member holds on one day: the recurring template, with date-specific
 * overrides layered on (`blocked` removes, `available` adds) and an absence
 * outranking both.
 */
function hoursForDay(
  userId: number,
  day: HorizonDay,
  index: GridIndex,
): Set<number> {
  if (index.absences.get(userId)?.has(day.dateStr)) return new Set();
  const hours = new Set(
    index.templates.get(`${userId}:${day.dayOfWeek}`) ?? [],
  );
  const overrides = index.overrides.get(`${userId}:${day.dateStr}`);
  if (overrides) {
    for (const [hour, status] of overrides) {
      if (status === 'blocked') hours.delete(hour);
      else hours.add(hour);
    }
  }
  return hours;
}

/** Project the grid into per-member sets of hour-start ISO instants. */
function buildBaseSlots(
  memberIds: number[],
  days: HorizonDay[],
  index: GridIndex,
  horizon: OverlapHorizon,
): MemberSlots {
  const slots: MemberSlots = new Map(
    memberIds.map((id) => [id, new Set<string>()]),
  );
  const from = horizon.start.getTime();
  const to = horizon.end.getTime();
  for (const [userId, set] of slots) {
    for (const day of days) {
      for (const hour of hoursForDay(userId, day, index)) {
        const ms = day.startMs + hour * HOUR_MS;
        if (ms >= from && ms + HOUR_MS <= to)
          set.add(new Date(ms).toISOString());
      }
    }
  }
  return slots;
}

/**
 * Hour starts a tsrange row covers, clamped to the horizon.
 *
 * `'contained'` (used for additions) only yields whole hours the row fully
 * covers; `'touched'` (used for removals) yields every hour the row overlaps
 * at all, so a 20:30–20:45 block still takes 20:00 off the table.
 */
function hoursInRange(
  range: [Date, Date],
  horizon: OverlapHorizon,
  mode: 'contained' | 'touched',
): string[] {
  const from = Math.max(range[0].getTime(), horizon.start.getTime());
  const to = Math.min(range[1].getTime(), horizon.end.getTime());
  const hours: string[] = [];
  let ms =
    mode === 'contained'
      ? Math.ceil(from / HOUR_MS) * HOUR_MS
      : Math.floor(from / HOUR_MS) * HOUR_MS;
  while (mode === 'contained' ? ms + HOUR_MS <= to : ms < to) {
    hours.push(new Date(ms).toISOString());
    ms += HOUR_MS;
  }
  return hours;
}

/**
 * Layer the tsrange `availability` rows over the grid: `available` adds hours,
 * `blocked` / `committed` remove them. Additions are applied first so a removal
 * always wins — never advertise a slot somebody is already committed to.
 * `freed` is deliberately inert: it records that a commitment lapsed, not that
 * the player put the hour back on their grid.
 */
function applyRanges(
  slots: MemberSlots,
  rows: GridRows['ranges'],
  horizon: OverlapHorizon,
): void {
  for (const row of rows) {
    if (row.status !== 'available') continue;
    const set = slots.get(row.userId);
    if (!set) continue;
    for (const hour of hoursInRange(row.timeRange, horizon, 'contained')) {
      set.add(hour);
    }
  }
  for (const row of rows) {
    if (row.status !== 'blocked' && row.status !== 'committed') continue;
    const set = slots.get(row.userId);
    if (!set) continue;
    for (const hour of hoursInRange(row.timeRange, horizon, 'touched')) {
      set.delete(hour);
    }
  }
}

/**
 * Resolve the roster's availability into one hour-set per member.
 *
 * @param db - Drizzle handle.
 * @param memberIds - Live roster. Every id gets an entry, possibly empty — the
 *   ranking helpers derive the roster size from the map, so a member with no
 *   grid must still be present.
 * @param now - Instant the horizon starts from.
 * @param days - Horizon length in days.
 * @returns userId -> set of hour-start ISO instants.
 */
export async function loadMemberSlots(
  db: LfgDb,
  memberIds: number[],
  now: Date,
  days: number = LFG_OVERLAP_HORIZON_DAYS,
): Promise<MemberSlots> {
  if (memberIds.length === 0) return new Map();
  const horizon = buildHorizon(now, days);
  const horizonDays = enumerateDays(horizon);
  const rows = await fetchGridRows(db, memberIds, horizon);
  const slots = buildBaseSlots(
    memberIds,
    horizonDays,
    indexGrid(rows, horizonDays),
    horizon,
  );
  applyRanges(slots, rows.ranges, horizon);
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
 * @returns The wire response, windows capped at {@link LFG_OVERLAP_WINDOWS}.
 */
export async function buildOverlapResponse(
  db: LfgDb,
  gameId: number,
): Promise<LfgOverlapResponseDto> {
  const members = await listGroupMembers(db, gameId);
  const slots = await loadMemberSlots(
    db,
    members.map((m) => m.userId),
    new Date(),
  );
  return {
    gameId,
    memberCount: members.length,
    horizonDays: LFG_OVERLAP_HORIZON_DAYS,
    windows: computeOverlapWindows(slots),
  };
}
