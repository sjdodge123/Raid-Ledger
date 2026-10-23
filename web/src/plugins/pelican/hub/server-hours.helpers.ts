/**
 * ROK-1876 L3 / ROK-1877 L1 — the server hub's "Server hours" model, from the
 * `GET /game-servers/calendar` items. Pure and Intl-only (it loads with the
 * hub module at boot). `serverKey` is `String(pelican_servers.id)`, the same
 * id the hub DTO carries as `page.server.pelicanServerId`.
 *
 * The now line puts the live state first and the schedule second, and never
 * contradicts itself: a manual start reads "outside its usual hours", a stop
 * or crash inside the hours reads "usually up until …" (ROK-1877 Q2/Q7).
 */
import type {
    GameServerCalendarItemDto,
    GameServerMarkerItemDto,
    GameServerState,
    GameServerWindowItemDto,
} from '@raid-ledger/contract';
import type { CalendarLayerRange } from '../../calendar-layer';
import { DAY_MS, HOUR_MS, dayLabel, whenLabel, windowSpans } from './server-hours-time.helpers';
import { powerLine, weekRows, type WeekRow } from './server-hours-week.helpers';

/** Operator ruling 2026-10-21 (kept by ROK-1877 Q3): the empty copy is always this, whatever the state. */
export const SERVER_HOURS_EMPTY = 'No set hours';
const RANGE_MS = 7 * DAY_MS;
/** Look-behind so today's already-ended windows still count towards today's weekly pattern (a local day is at most 25h). */
const LOOKBACK_MS = DAY_MS + 2 * HOUR_MS;

export type NowTone = 'online' | 'offline' | 'warn' | 'neutral';
/** The now line in parts: `head` ("Online now"), the schedule `tail` ("until 10:00 PM"), an optional second line. */
export interface NowModel { tone: NowTone; head: string; tail: string | null; sub: string | null }

export interface ServerHoursDay { key: string; day: string; spans: string }
export interface ServerHours {
    /** `head · tail` as one string (the existing test id's text). */
    nowLine: string;
    now: NowModel;
    /** ROK-1876's one-row-per-day list (open windows under today); superseded on the card by `weekRows`. */
    days: ServerHoursDay[];
    weekRows: WeekRow[];
    startLine: string | null;
    stopLine: string | null;
    restartLine: string | null;
    /** No weekly rows and no start/stop line: the card shows {@link SERVER_HOURS_EMPTY}. */
    empty: boolean;
}

export interface ServerHoursInput {
    items: readonly GameServerCalendarItemDto[];
    pelicanServerId: number;
    state: GameServerState;
    now: number;
    tz: string;
}

/** Seven days ahead of `now`, plus a day of look-behind for today's earlier windows. */
export function hoursRange(now: number): CalendarLayerRange {
    return { from: new Date(now - LOOKBACK_MS).toISOString(), to: new Date(now + RANGE_MS).toISOString() };
}

function ownItems(items: readonly GameServerCalendarItemDto[], pelicanServerId: number) {
    const key = String(pelicanServerId);
    const mine = items.filter((i) => i.serverKey === key);
    const windows = mine.filter((i): i is GameServerWindowItemDto => i.kind === 'window').sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const markers = mine.filter((i): i is GameServerMarkerItemDto => i.kind === 'marker').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { windows, markers };
}

const TRANSIENT_HEAD: Partial<Record<GameServerState, string>> = { starting: 'Starting…', stopping: 'Stopping…', unknown: 'Status unknown' };

/** The schedule tail shared by S1/S2/S5/S8: "until 10:00 PM" inside a window, "next up Sat 2:00 PM" before one. */
function scheduleTail(open: GameServerWindowItemDto | undefined, next: GameServerWindowItemDto | undefined, now: number, tz: string): string | null {
    if (open) return `until ${whenLabel(Date.parse(open.end), now, tz)}`;
    return next ? `next up ${whenLabel(Date.parse(next.start), now, tz)}` : null;
}

/** Spec §3 S1–S6 and S8. Only windows that have not ended count. */
export function nowModel(state: GameServerState, windows: readonly GameServerWindowItemDto[], now: number, tz: string): NowModel {
    const open = windows.find((w) => Date.parse(w.start) <= now && Date.parse(w.end) > now);
    const next = windows.find((w) => Date.parse(w.start) > now);
    const transient = TRANSIENT_HEAD[state];
    if (transient !== undefined) return { tone: 'neutral', head: transient, tail: scheduleTail(open, next, now, tz), sub: null };
    if (state === 'running') {
        if (open || !next) return { tone: 'online', head: 'Online now', tail: scheduleTail(open, undefined, now, tz), sub: null };
        return { tone: 'online', head: 'Online now', tail: 'outside its usual hours', sub: `Next scheduled: ${whenLabel(Date.parse(next.start), now, tz)}` };
    }
    if (open) return { tone: 'warn', head: 'Offline', tail: `usually up until ${whenLabel(Date.parse(open.end), now, tz)}`, sub: null };
    return { tone: 'offline', head: 'Offline', tail: scheduleTail(undefined, next, now, tz), sub: null };
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

/** The widget's whole model; `empty` is the "No set hours" state. */
export function buildServerHours({ items, pelicanServerId, state, now, tz }: ServerHoursInput): ServerHours {
    const { windows, markers } = ownItems(items, pelicanServerId);
    const nowPart = nowModel(state, windows, now, tz);
    const week = weekRows(windows, now, tz);
    const startLine = powerLine('start', markers, now, tz);
    const stopLine = powerLine('stop', markers, now, tz);
    return {
        nowLine: nowPart.tail === null ? nowPart.head : `${nowPart.head} · ${nowPart.tail}`,
        now: nowPart,
        days: dayRows(windows, now, tz),
        weekRows: week,
        startLine,
        stopLine,
        restartLine: powerLine('restart', markers, now, tz),
        empty: week.length === 0 && startLine === null && stopLine === null,
    };
}
