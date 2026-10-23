/**
 * ROK-1876 / ROK-1877 — the server-hours card's local-time primitives, shared
 * by the day rows, the weekly summary and the now line. Pure and Intl-only.
 * Every function takes the viewer's IANA `tz`; nothing assumes a 24h day.
 */
import type { GameServerWindowItemDto } from '@raid-ledger/contract';
import { formatLocalTime } from '../calendar/pelican-calendar-items.helpers';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** "2026-10-14" in `tz` — the day-grouping key. */
export function dayKey(ms: number, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(ms);
}

/** The short weekday in `tz` ("Thu"). */
export function weekday(ms: number, tz: string): string {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(ms);
}

/** "Today" for the viewer's current day, otherwise the short weekday ("Thu"). */
export function dayLabel(ms: number, now: number, tz: string): string {
    return dayKey(ms, tz) === dayKey(now, tz) ? 'Today' : weekday(ms, tz);
}

/** "4:05 AM" in `tz`. */
export function clock(ms: number, tz: string): string {
    return formatLocalTime(new Date(ms).toISOString(), tz);
}

/** "6:00 PM" today, "Fri 6:00 PM" on any other day. */
export function whenLabel(ms: number, now: number, tz: string): string {
    const day = dayLabel(ms, now, tz);
    const time = clock(ms, tz);
    return day === 'Today' ? time : `${day} ${time}`;
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock of `ms` in `tz` as a UTC-epoch number, so calendar-date arithmetic is plain `Date.UTC` math. */
function wallMs(ms: number, tz: string): number {
    let fmt = wallFormatters.get(tz);
    if (fmt === undefined) {
        fmt = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZone: tz });
        wallFormatters.set(tz, fmt);
    }
    const parts = fmt.formatToParts(ms);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second')) + (((ms % 1000) + 1000) % 1000);
}

/** The first instant after `ms` whose local date differs — a ms-precision search over the next 26h (fallback for a midnight a DST gap skips). */
function firstInstantOfNextDay(ms: number, tz: string): number {
    const key = dayKey(ms, tz);
    let lo = ms;
    let hi = ms + 26 * HOUR_MS;
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (dayKey(mid, tz) === key) lo = mid;
        else hi = mid;
    }
    return hi;
}

/**
 * The instant of the next local midnight after `ms` in `tz`: the next calendar date's 00:00, found from the
 * zone's own wall clock, so any offset change (1h, a half-hour Lord Howe shift) lands on a new date (Codex r2).
 */
export function nextMidnight(ms: number, tz: string): number {
    const wall = new Date(wallMs(ms, tz));
    const target = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
    let guess = ms + (target - wall.getTime());
    for (let i = 0; i < 3; i++) guess += target - wallMs(guess, tz);
    const key = dayKey(ms, tz);
    if (dayKey(guess, tz) !== key && dayKey(guess - 1, tz) === key) return guess;
    return firstInstantOfNextDay(ms, tz);
}

/** The day keys of today and the next `count - 1` local days, in order (DST-safe: steps midnight to midnight). */
export function localDayKeys(now: number, tz: string, count: number): string[] {
    const keys = [dayKey(now, tz)];
    for (let cursor = now; keys.length < count;) {
        cursor = nextMidnight(cursor, tz);
        keys.push(dayKey(cursor, tz));
    }
    return keys;
}

export interface DaySpan { key: string; anchor: number; span: string }

/** The start day's span; a 24h window inside one 25h DST day ends there too, so it gets both ends. */
function startDaySpan(start: number, end: number, endsHere: boolean, tz: string): string {
    return endsHere ? `${clock(start, tz)} – ${clock(end, tz)}` : `from ${clock(start, tz)}`;
}

/** A 24h+ window as one span per local day: "from 10:00 PM", "All day", "until 6:00 AM". Days before `from` are skipped. */
function multiDaySpans(start: number, end: number, from: number, tz: string): DaySpan[] {
    const spans: DaySpan[] = [];
    const startKey = dayKey(start, tz);
    for (let cursor = from; cursor < end;) {
        const midnight = nextMidnight(cursor, tz);
        const key = dayKey(cursor, tz);
        const endsHere = end < midnight;
        const span = key === startKey ? startDaySpan(start, end, endsHere, tz) : endsHere ? `until ${clock(end, tz)}` : 'All day';
        spans.push({ key, anchor: cursor, span });
        cursor = midnight;
    }
    return spans;
}

/**
 * A window's per-day spans from `floor` on. Under 24h stays one "6:00 PM – 2:00 AM" span on its
 * start (or, once open, the floor's) day; longer windows split per local day (Codex r1).
 */
export function windowSpans(w: GameServerWindowItemDto, floor: number, tz: string): DaySpan[] {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    const from = Math.max(start, floor);
    if (end - start >= DAY_MS) return multiDaySpans(start, end, from, tz);
    return [{ key: dayKey(from, tz), anchor: from, span: `${clock(start, tz)} – ${clock(end, tz)}` }];
}
