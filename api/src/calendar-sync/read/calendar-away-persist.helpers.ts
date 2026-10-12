/**
 * ROK-1593 PR-B (B3a, epic ROK-669 §4.6): persist synced away days.
 *
 * `runCalendarDerive(tx, userId, opts)` loads the derivation inputs, calls the
 * pure `deriveAwayRanges` and diff-writes the user's `source = 'calendar'`
 * `game_time_absences` rows. Every statement runs on the `tx` handed in (the
 * read-sync transaction, or a caller's own).
 *
 * - **Blocks:** only connections with `status = 'active' AND read_enabled`
 *   count (Q12/D11, same rule as `calendar-busy-query.helpers.ts`), across ALL
 *   of the user's connections (Q16), overlapping the read window.
 * - **Window:** local midnight today + `LOOK_AHEAD_DAYS` (`buildReadWindow`).
 * - **History:** calendar rows that ended before today are never touched. A
 *   row straddling today is compared on its window-clipped range, so it keeps
 *   its id while it still matches.
 * - **R4 safety net:** a block within ±60 s of one of the user's active
 *   sign-ups is our own copy (`matchesSignupBounds`) and never makes a day.
 * - **Serialised per user:** a transaction-scoped advisory lock keyed on the
 *   user, so a sync's derive and a queued `derive` job never diff the same
 *   rows at once (both would insert the same range).
 * - **Manual rows** are never loaded into the diff; `planCalendarAbsenceWrites`
 *   also ignores any non-calendar row it is handed.
 */
import { and, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { CalendarReadModeSchema } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  deriveAwayRanges,
  expandWithinWindow,
  type AwayDeriveInput,
  type DerivedAwayRange,
} from './calendar-away-derive.helpers';
import {
  CALENDAR_READ_MODE_KEY,
  matchesSignupBounds,
  querySignupBounds,
  type CalendarReadMode,
} from './calendar-busy-query.helpers';
import {
  buildReadWindow,
  type ReadWindow,
} from './calendar-read-normalize.helpers';
import type { ReadSyncTx } from './calendar-read-sync.helpers';

/** One existing absence row as the diff needs it. */
export interface ExistingAwayRow {
  id: number;
  source: string;
  startDate: string;
  endDate: string;
  calendarConnectionId: number | null;
}

export interface CalendarAbsenceWritePlan {
  insert: DerivedAwayRange[];
  update: { id: number; calendarConnectionId: number }[];
  deleteIds: number[];
}

export interface CalendarDeriveOptions {
  /** `app_settings.default_timezone` (or 'UTC') for users without one. */
  defaultTimezone: string;
  now?: Date;
}

export interface CalendarDeriveResult {
  inserted: number;
  updated: number;
  deleted: number;
}

const rangeKey = (r: { startDate: string; endDate: string }): string =>
  `${r.startDate}|${r.endDate}`;

/**
 * PURE diff by `(startDate, endDate)`: an unchanged range keeps its id (no
 * write); a re-attributed range updates only `calendarConnectionId`; a range
 * no longer derived is deleted; a new range is inserted. Rows whose `source`
 * is not `'calendar'` are ignored — never updated, never deleted. A duplicate
 * calendar row for an already-matched range is deleted.
 */
export function planCalendarAbsenceWrites(
  existing: readonly ExistingAwayRow[],
  derived: readonly DerivedAwayRange[],
): CalendarAbsenceWritePlan {
  const wanted = new Map(derived.map((r) => [rangeKey(r), r]));
  const matched = new Set<string>();
  const plan: CalendarAbsenceWritePlan = {
    insert: [],
    update: [],
    deleteIds: [],
  };
  for (const row of existing) {
    if (row.source !== 'calendar') continue;
    const key = rangeKey(row);
    const target = wanted.get(key);
    if (target === undefined || matched.has(key)) {
      plan.deleteIds.push(row.id);
      continue;
    }
    matched.add(key);
    if (row.calendarConnectionId !== target.calendarConnectionId) {
      plan.update.push({
        id: row.id,
        calendarConnectionId: target.calendarConnectionId,
      });
    }
  }
  plan.insert = derived.filter((r) => !matched.has(rangeKey(r)));
  return plan;
}

async function loadPreference(
  tx: ReadSyncTx,
  userId: number,
  key: string,
): Promise<unknown> {
  const p = schema.userPreferences;
  const [row] = await tx
    .select({ value: p.value })
    .from(p)
    .where(and(eq(p.userId, userId), eq(p.key, key)))
    .limit(1);
  return row?.value;
}

async function loadReadMode(
  tx: ReadSyncTx,
  userId: number,
): Promise<CalendarReadMode> {
  const parsed = CalendarReadModeSchema.safeParse(
    await loadPreference(tx, userId, CALENDAR_READ_MODE_KEY),
  );
  return parsed.success ? parsed.data : 'both';
}

/** Same rule as `resolveUserTimezone`; an unknown zone falls back to UTC. */
async function loadWindow(
  tx: ReadSyncTx,
  userId: number,
  opts: CalendarDeriveOptions,
): Promise<ReadWindow> {
  const tz = await loadPreference(tx, userId, 'timezone');
  const zone =
    typeof tz === 'string' && tz !== '' && tz !== 'auto'
      ? tz
      : opts.defaultTimezone;
  const now = opts.now ?? new Date();
  try {
    return buildReadWindow(now, zone);
  } catch {
    return buildReadWindow(now, 'UTC');
  }
}

/** Blocks of the user's active, read-enabled connections inside `window`. */
function loadActiveBlocks(tx: ReadSyncTx, userId: number, window: ReadWindow) {
  const b = schema.calendarBusyBlocks;
  const c = schema.calendarConnections;
  return tx
    .select({
      connectionId: b.connectionId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      allDay: b.allDay,
      firstDate: b.firstDate,
      lastDate: b.lastDate,
    })
    .from(b)
    .innerJoin(c, eq(b.connectionId, c.id))
    .where(
      and(
        eq(b.userId, userId),
        eq(c.status, 'active'),
        eq(c.readEnabled, true),
        lt(b.startsAt, window.end),
        gt(b.endsAt, window.start),
      ),
    );
}

async function loadSkipDates(
  tx: ReadSyncTx,
  userId: number,
  window: ReadWindow,
) {
  const ig = schema.calendarIgnoredDays;
  const a = schema.gameTimeAbsences;
  const [ignored, manual] = await Promise.all([
    tx
      .select({ date: ig.date })
      .from(ig)
      .where(and(eq(ig.userId, userId), gte(ig.date, window.firstDate))),
    tx
      .select({ startDate: a.startDate, endDate: a.endDate })
      .from(a)
      .where(
        and(
          eq(a.userId, userId),
          eq(a.source, 'manual'),
          gte(a.endDate, window.firstDate),
          lte(a.startDate, window.lastDate),
        ),
      ),
  ]);
  return {
    ignoredDates: ignored.map((r) => r.date),
    // Clipped to the window BEFORE expanding (BLOCKER-1): an absence ending
    // 9999-12-31 contributes at most LOOK_AHEAD_DAYS dates.
    manualDates: manual.flatMap((r) => expandWithinWindow(r, window)),
  };
}

/** R4: drop blocks that are our own copy of one of the user's sign-ups. */
export function dropSignupCopies<T extends { startsAt: Date; endsAt: Date }>(
  blocks: readonly T[],
  signups: readonly [Date, Date][],
): T[] {
  return blocks.filter((b) => !matchesSignupBounds(b, signups));
}

async function loadDeriveInput(
  tx: ReadSyncTx,
  userId: number,
  window: ReadWindow,
): Promise<AwayDeriveInput> {
  const t = schema.gameTimeTemplates;
  const [blocks, signups, mode, templateHours, skip] = await Promise.all([
    loadActiveBlocks(tx, userId, window),
    querySignupBounds(tx, [userId], window.start, window.end),
    loadReadMode(tx, userId),
    tx
      .select({ dayOfWeek: t.dayOfWeek, startHour: t.startHour })
      .from(t)
      .where(eq(t.userId, userId)),
    loadSkipDates(tx, userId, window),
  ]);
  const range = { start: window.start, end: window.end };
  return {
    blocks: dropSignupCopies(blocks, signups.get(userId) ?? []),
    mode,
    templateHours,
    timeZone: window.timeZone,
    window: range,
    ...skip,
  };
}

/** Calendar rows still current (ending today or later), start clipped to today. */
async function loadExistingCalendarRows(
  tx: ReadSyncTx,
  userId: number,
  window: ReadWindow,
): Promise<ExistingAwayRow[]> {
  const a = schema.gameTimeAbsences;
  const rows = await tx
    .select({
      id: a.id,
      source: a.source,
      startDate: a.startDate,
      endDate: a.endDate,
      calendarConnectionId: a.calendarConnectionId,
    })
    .from(a)
    .where(
      and(
        eq(a.userId, userId),
        eq(a.source, 'calendar'),
        gte(a.endDate, window.firstDate),
      ),
    );
  return rows.map((r) => ({
    ...r,
    startDate: r.startDate < window.firstDate ? window.firstDate : r.startDate,
  }));
}

async function applyPlan(
  tx: ReadSyncTx,
  userId: number,
  plan: CalendarAbsenceWritePlan,
): Promise<void> {
  const a = schema.gameTimeAbsences;
  const calendarOnly = and(eq(a.userId, userId), eq(a.source, 'calendar'));
  if (plan.deleteIds.length > 0) {
    await tx.delete(a).where(and(calendarOnly, inArray(a.id, plan.deleteIds)));
  }
  for (const u of plan.update) {
    await tx
      .update(a)
      .set({
        calendarConnectionId: u.calendarConnectionId,
        updatedAt: new Date(),
      })
      .where(and(calendarOnly, eq(a.id, u.id)));
  }
  if (plan.insert.length === 0) return;
  await tx
    .insert(a)
    .values(plan.insert.map((r) => ({ ...r, userId, source: 'calendar' })));
}

/**
 * Re-derive `userId`'s synced away days and diff-write them on `tx`. Mode
 * `hours` (or no blocks) derives nothing, so every current calendar row goes.
 */
export async function runCalendarDerive(
  tx: ReadSyncTx,
  userId: number,
  opts: CalendarDeriveOptions,
): Promise<CalendarDeriveResult> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('calendar-derive'), ${userId})`,
  );
  const window = await loadWindow(tx, userId, opts);
  const [input, existing] = await Promise.all([
    loadDeriveInput(tx, userId, window),
    loadExistingCalendarRows(tx, userId, window),
  ]);
  const plan = planCalendarAbsenceWrites(existing, deriveAwayRanges(input));
  await applyPlan(tx, userId, plan);
  return {
    inserted: plan.insert.length,
    updated: plan.update.length,
    deleted: plan.deleteIds.length,
  };
}
