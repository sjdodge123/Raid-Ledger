/**
 * ROK-1876 L3 — the server hub's "Server hours" model, from the
 * `GET /game-servers/calendar` items. Pure and Intl-only (it loads with the
 * hub module at boot). `serverKey` is `String(pelican_servers.id)`, the same
 * id the hub DTO carries as `page.server.pelicanServerId`.
 */
import type {
    GameServerCalendarItemDto,
    GameServerMarkerItemDto,
    GameServerState,
    GameServerWindowItemDto,
} from '@raid-ledger/contract';
import type { CalendarLayerRange } from '../../calendar-layer';
import { STATE_LABELS, formatLocalTime } from '../calendar/pelican-calendar-items.helpers';

/** Operator ruling 2026-10-21: the empty copy is always this, whatever the state. */
export const SERVER_HOURS_EMPTY = 'No set hours';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RANGE_MS = 7 * DAY_MS;

export interface ServerHoursDay { key: string; day: string; spans: string }
export interface ServerHours { nowLine: string; days: ServerHoursDay[]; restartLine: string | null }

export interface ServerHoursInput {
    items: readonly GameServerCalendarItemDto[];
    pelicanServerId: number;
    state: GameServerState;
    now: number;
    tz: string;
}

/** The next seven days from `now`. */
export function hoursRange(now: number): CalendarLayerRange {
    return { from: new Date(now).toISOString(), to: new Date(now + RANGE_MS).toISOString() };
}

/** "2026-10-14" in `tz` — the day-grouping key. */
function dayKey(ms: number, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(ms);
}

/** "Today" for the viewer's current day, otherwise the short weekday ("Thu"). */
function dayLabel(ms: number, now: number, tz: string): string {
    if (dayKey(ms, tz) === dayKey(now, tz)) return 'Today';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(ms);
}

/** "6:00 PM" today, "Fri 6:00 PM" on any other day. */
function whenLabel(iso: string, now: number, tz: string): string {
    const day = dayLabel(Date.parse(iso), now, tz);
    const time = formatLocalTime(iso, tz);
    return day === 'Today' ? time : `${day} ${time}`;
}

function ownItems(items: readonly GameServerCalendarItemDto[], pelicanServerId: number) {
    const key = String(pelicanServerId);
    const mine = items.filter((i) => i.serverKey === key);
    const windows = mine.filter((i): i is GameServerWindowItemDto => i.kind === 'window').sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const markers = mine.filter((i): i is GameServerMarkerItemDto => i.kind === 'marker').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { windows, markers };
}

function nowLine(state: GameServerState, windows: readonly GameServerWindowItemDto[], now: number, tz: string): string {
    const label = STATE_LABELS[state];
    const open = windows.find((w) => Date.parse(w.start) <= now && Date.parse(w.end) > now);
    if (open) return `${label} · closes ${whenLabel(open.end, now, tz)}`;
    const next = windows.find((w) => Date.parse(w.start) > now);
    return next ? `${label} · opens ${whenLabel(next.start, now, tz)}` : label;
}

/** The instant of the first local midnight after `ms` in `tz`; re-checked against the day key so a 23h/25h DST day lands on midnight. */
function nextMidnight(ms: number, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZone: tz }).formatToParts(ms);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const elapsed = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + (ms % 1000);
    const candidate = ms - elapsed + DAY_MS;
    if (dayKey(candidate, tz) === dayKey(ms, tz)) return candidate + HOUR_MS;
    if (dayKey(candidate - 1, tz) !== dayKey(ms, tz)) return candidate - HOUR_MS;
    return candidate;
}

interface DaySpan { key: string; anchor: number; span: string }

/** A 24h+ window as one span per local day: "from 10:00 PM", "All day", "until 6:00 AM". Days before `from` are skipped. */
function multiDaySpans(start: number, end: number, from: number, tz: string): DaySpan[] {
    const spans: DaySpan[] = [];
    const startKey = dayKey(start, tz);
    for (let cursor = from; cursor < end;) {
        const midnight = nextMidnight(cursor, tz);
        const key = dayKey(cursor, tz);
        const endsHere = end < midnight;
        const span = key === startKey ? `from ${clock(start, tz)}` : endsHere ? `until ${clock(end, tz)}` : 'All day';
        spans.push({ key, anchor: cursor, span });
        cursor = midnight;
    }
    return spans;
}

function clock(ms: number, tz: string): string {
    return formatLocalTime(new Date(ms).toISOString(), tz);
}

/** Under 24h stays one "6:00 PM – 2:00 AM" span on its first (or today's) day; longer windows split per local day (Codex r1). */
function windowSpans(w: GameServerWindowItemDto, now: number, tz: string): DaySpan[] {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    const from = Math.max(start, now);
    if (end - start >= DAY_MS) return multiDaySpans(start, end, from, tz);
    return [{ key: dayKey(from, tz), anchor: from, span: `${clock(start, tz)} – ${clock(end, tz)}` }];
}

/** One row per day with a window that has not ended; an open window sits under today. */
function dayRows(windows: readonly GameServerWindowItemDto[], now: number, tz: string): ServerHoursDay[] {
    const rows = new Map<string, ServerHoursDay>();
    for (const w of windows) {
        if (Date.parse(w.end) <= now) continue;
        for (const { key, anchor, span } of windowSpans(w, now, tz)) {
            const row = rows.get(key);
            if (row) row.spans = `${row.spans}, ${span}`;
            else rows.set(key, { key, day: dayLabel(anchor, now, tz), spans: span });
        }
    }
    return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function restartLine(markers: readonly GameServerMarkerItemDto[], now: number, tz: string): string | null {
    const next = markers.find((m) => m.effect === 'restart' && Date.parse(m.at) >= now);
    if (!next) return null;
    return `Restart · ${dayLabel(Date.parse(next.at), now, tz)} ${formatLocalTime(next.at, tz)}`;
}

/** The widget's whole model; `days: []` is the empty state. */
export function buildServerHours({ items, pelicanServerId, state, now, tz }: ServerHoursInput): ServerHours {
    const { windows, markers } = ownItems(items, pelicanServerId);
    return { nowLine: nowLine(state, windows, now, tz), days: dayRows(windows, now, tz), restartLine: restartLine(markers, now, tz) };
}
