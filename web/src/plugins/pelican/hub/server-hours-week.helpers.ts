/**
 * ROK-1877 — the server-hours card's weekly summary and its muted power lines.
 *
 * Built from the projected run instants (spec D1), never from a cron converted
 * once: the seven local days from today each get their span list, and runs of
 * consecutive identical days merge, cyclically ("Every day", "Mon–Fri", "Fri, Sat"). A day
 * whose local times move at a DST change differs, so it keeps its own row
 * (Q6). The caller fetches a day of look-behind so today's earlier windows
 * still count towards today's pattern.
 */
import type { GameServerMarkerItemDto, GameServerWindowItemDto } from '@raid-ledger/contract';
import { clock, dayKey, dayLabel, localDayKeys, weekday, windowSpans } from './server-hours-time.helpers';

const WEEK_DAYS = 7;

export interface WeekRow { key: string; label: string; spans: string }

interface DayCell { key: string; name: string; spans: string }

/** "Every day" / "Mon–Fri" (3+ days) / "Fri, Sat" / "Sun". */
function runLabel(run: readonly DayCell[]): string {
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) return '';
    if (run.length === WEEK_DAYS) return 'Every day';
    if (run.length === 1) return first.name;
    return run.length === 2 ? `${first.name}, ${last.name}` : `${first.name}–${last.name}`;
}

/** Each of the seven local days with its spans (in start order); a day with no window has `spans: ''`. */
function weekCells(windows: readonly GameServerWindowItemDto[], now: number, tz: string): DayCell[] {
    const keys = localDayKeys(now, tz, WEEK_DAYS);
    const spans = new Map<string, string[]>(keys.map((k) => [k, []]));
    const names = new Map<string, string>();
    for (const w of windows) {
        for (const s of windowSpans(w, Date.parse(w.start), tz)) {
            const list = spans.get(s.key);
            if (!list) continue;
            list.push(s.span);
            names.set(s.key, weekday(s.anchor, tz));
        }
    }
    return keys.map((key) => ({ key, name: names.get(key) ?? '', spans: (spans.get(key) ?? []).join(', ') }));
}

/** Where a weekly run starts: the first day (from today) whose spans differ from the day before it, cyclically; 0 when all match. */
function cycleStart(cells: readonly DayCell[]): number {
    const start = cells.findIndex((cell, i) => cell.spans !== cells[(i + cells.length - 1) % cells.length]?.spans);
    return Math.max(start, 0);
}

/**
 * The weekly rows; days without a window are left out, `[]` when nothing is scheduled this week.
 * The seven days are one weekly cycle, so runs merge across the week's end: a Mon–Fri schedule
 * reads "Mon–Fri" whatever today is, and Fri+Sat reads "Fri, Sat" on a Saturday too (review r1).
 * Row order starts from today (spec D2): the run holding today first, then the rest in week order.
 */
export function weekRows(windows: readonly GameServerWindowItemDto[], now: number, tz: string): WeekRow[] {
    const cells = weekCells(windows, now, tz);
    const start = cycleStart(cells);
    const runs: DayCell[][] = [];
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[(start + i) % cells.length];
        if (!cell) continue;
        const run = runs[runs.length - 1];
        if (run && run[0]?.spans === cell.spans) run.push(cell);
        else runs.push([cell]);
    }
    const todayKey = cells[0]?.key;
    const first = Math.max(runs.findIndex((run) => run.some((c) => c.key === todayKey)), 0);
    return [...runs.slice(first), ...runs.slice(0, first)]
        .filter((run) => (run[0]?.spans ?? '') !== '')
        .map((run) => ({ key: run.some((c) => c.key === todayKey) ? (todayKey ?? '') : (run[0]?.key ?? ''), label: runLabel(run), spans: run[0]?.spans ?? '' }));
}

/** "6:00 PM" when every one of the seven days has this effect at the same local time(s), else null. */
function dailyTimes(markers: readonly GameServerMarkerItemDto[], now: number, tz: string): string | null {
    const keys = localDayKeys(now, tz, WEEK_DAYS);
    const byDay = new Map<string, string[]>(keys.map((k) => [k, []]));
    for (const m of markers) byDay.get(dayKey(Date.parse(m.at), tz))?.push(clock(Date.parse(m.at), tz));
    const lists = keys.map((k) => (byDay.get(k) ?? []).join(', '));
    const first = lists[0] ?? '';
    return first !== '' && lists.every((l) => l === first) ? first : null;
}

export type PowerLineEffect = 'restart' | 'start' | 'stop';

const POWER_LINE: Record<PowerLineEffect, { label: string; daily: string }> = {
    restart: { label: 'Restart', daily: 'nightly' },
    start: { label: 'Starts', daily: 'daily' },
    stop: { label: 'Stops', daily: 'daily' },
};

/**
 * "Restart · nightly 12:05 AM" / "Starts · daily 6:00 PM" when every day matches (Q4, Q8);
 * otherwise the next one ("Stops · Sat 2:00 AM", "Restart · Today 4:05 AM"); null when none is ahead.
 */
export function powerLine(effect: PowerLineEffect, markers: readonly GameServerMarkerItemDto[], now: number, tz: string): string | null {
    const copy = POWER_LINE[effect];
    const own = markers.filter((m) => m.effect === effect);
    const daily = dailyTimes(own, now, tz);
    if (daily !== null) return `${copy.label} · ${copy.daily} ${daily}`;
    const next = own.find((m) => Date.parse(m.at) >= now);
    if (!next) return null;
    const at = Date.parse(next.at);
    return `${copy.label} · ${dayLabel(at, now, tz)} ${clock(at, tz)}`;
}
