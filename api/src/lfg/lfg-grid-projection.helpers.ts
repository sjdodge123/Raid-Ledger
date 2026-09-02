/**
 * Pure projection of the game-time grid into per-member hour sets
 * (ROK-1463 §A). Nothing here touches the database — `lfg-overlap-grid.helpers`
 * fetches the rows, this module turns them into instants.
 *
 * TIMEZONE (C1) — every `(date, hour)` on the grid is the MEMBER's own wall
 * clock, so each member is projected over THEIR local calendar days and each
 * hour is converted through {@link zonedHourToUtc} before it can be compared
 * with anybody else's. See `lfg-zoned-time.helpers.ts`.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import type { MemberSlots } from './lfg-overlap.helpers';
import {
  enumerateZonedDays,
  zonedHourToUtc,
  type ZonedDay,
} from './lfg-zoned-time.helpers';

const HOUR_MS = 60 * 60 * 1000;

/** Raw grid + availability rows for the whole roster, fetched in one round. */
export interface GridRows {
  templates: { userId: number; dayOfWeek: number; startHour: number }[];
  overrides: { userId: number; date: string; hour: number; status: string }[];
  absences: { userId: number; startDate: string; endDate: string }[];
  ranges: {
    userId: number;
    timeRange: [Date, Date];
    status: string;
    gameId: number | null;
  }[];
}

/** Half-open `[start, end)` instants the overlap read projects over. */
export interface OverlapHorizon {
  start: Date;
  end: Date;
}

/** Lookup tables keyed for the per-day projection below. */
export interface GridIndex {
  /** `userId:dayOfWeek` -> recurring template hours. */
  templates: Map<string, number[]>;
  /** `userId:YYYY-MM-DD` -> hour -> `'available' | 'blocked'`. */
  overrides: Map<string, Map<number, string>>;
  /** userId -> local `YYYY-MM-DD` days wholly blocked by an absence. */
  absences: Map<number, Set<string>>;
}

/**
 * The local dates an inclusive absence range covers.
 *
 * @param row - The absence, whose bounds are the member's local calendar days.
 * @param days - The member's local days inside the horizon; the result is
 *   clamped to them so an open-ended holiday cannot grow the index.
 */
export function absenceDates(
  row: { startDate: string; endDate: string },
  days: ZonedDay[],
): string[] {
  return days
    .filter((d) => d.dateStr >= row.startDate && d.dateStr <= row.endDate)
    .map((d) => d.dateStr);
}

/**
 * Build the lookup tables the per-day projection reads.
 *
 * @param rows - Everything fetched for the roster.
 * @param daysOf - The member's local horizon days, used to clamp absences.
 */
export function indexGrid(
  rows: GridRows,
  daysOf: (userId: number) => ZonedDay[],
): GridIndex {
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
    for (const date of absenceDates(a, daysOf(a.userId))) dates.add(date);
    index.absences.set(a.userId, dates);
  }
  return index;
}

/**
 * Hours a member holds on one of THEIR local days: the recurring template,
 * with date-specific overrides layered on (`blocked` removes, `available`
 * adds) and an absence outranking both.
 */
export function hoursForDay(
  userId: number,
  day: ZonedDay,
  index: GridIndex,
): Set<number> {
  if (index.absences.get(userId)?.has(day.dateStr)) return new Set();
  const hours = new Set(index.templates.get(`${userId}:${day.dayOfWeek}`) ?? []);
  const overrides = index.overrides.get(`${userId}:${day.dateStr}`);
  if (overrides) {
    for (const [hour, status] of overrides) {
      if (status === 'blocked') hours.delete(hour);
      else hours.add(hour);
    }
  }
  return hours;
}

/**
 * Project the grid into per-member sets of hour-start ISO instants.
 *
 * @param zones - userId -> IANA zone the member's grid is written in.
 * @param daysOf - The member's local horizon days.
 * @param index - Lookup tables from {@link indexGrid}.
 * @param horizon - Instants outside it are dropped, so a local hour that only
 *   partly overlaps the horizon is never offered.
 */
export function buildBaseSlots(
  zones: Map<number, string>,
  daysOf: (userId: number) => ZonedDay[],
  index: GridIndex,
  horizon: OverlapHorizon,
): MemberSlots {
  const slots: MemberSlots = new Map(
    [...zones.keys()].map((id) => [id, new Set<string>()]),
  );
  const from = horizon.start.getTime();
  const to = horizon.end.getTime();
  for (const [userId, set] of slots) {
    const timeZone = zones.get(userId)!;
    for (const day of daysOf(userId)) {
      for (const hour of hoursForDay(userId, day, index)) {
        const ms = zonedHourToUtc(day.dateStr, hour, timeZone).getTime();
        if (ms >= from && ms + HOUR_MS <= to) set.add(new Date(ms).toISOString());
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
export function hoursInRange(
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
 * Is this `available` row in scope for the game being read?
 *
 * `availability.game_id` scopes a row to ONE game (`availability.ts:38`); an
 * unscoped (null) row is general availability. Marking yourself free for Game
 * B must not advertise a window on Game A (W2 / Codex P2-a).
 */
function addsToGame(row: GridRows['ranges'][number], gameId: number): boolean {
  return row.gameId === null || row.gameId === gameId;
}

/**
 * Layer the tsrange `availability` rows over the grid: `available` adds hours,
 * `blocked` / `committed` remove them. Additions are applied first so a removal
 * always wins — never advertise a slot somebody is already committed to.
 * `freed` is deliberately inert: it records that a commitment lapsed, not that
 * the player put the hour back on their grid.
 *
 * Removals stay UNSCOPED by game on purpose: being busy is being busy, whoever
 * booked the time.
 *
 * @param gameId - Game being read, which scopes the additive pass.
 */
export function applyRanges(
  slots: MemberSlots,
  rows: GridRows['ranges'],
  horizon: OverlapHorizon,
  gameId: number,
): void {
  for (const row of rows) {
    if (row.status !== 'available' || !addsToGame(row, gameId)) continue;
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
 * The member's local horizon days, memoised per zone — a 14-day horizon is 15
 * days of enumeration and a roster usually shares two or three zones.
 *
 * @param zones - userId -> IANA zone.
 * @param horizon - Instants the days are derived from.
 */
export function zonedDayResolver(
  zones: Map<number, string>,
  horizon: OverlapHorizon,
): (userId: number) => ZonedDay[] {
  const byZone = new Map<string, ZonedDay[]>();
  return (userId) => {
    const timeZone = zones.get(userId) ?? 'UTC';
    const cached = byZone.get(timeZone);
    if (cached) return cached;
    const days = enumerateZonedDays(horizon.start, horizon.end, timeZone);
    byZone.set(timeZone, days);
    return days;
  };
}
