/**
 * ROK-1774 — pure mapping from generic plugin layer items to what the
 * react-big-calendar grid draws: windows become background events (split at
 * local midnight so a carried-over segment can say "(cont.)"), markers become
 * zoned points bucketed per day column. No plugin code is imported here.
 */
import { addDays, format, startOfDay } from 'date-fns';
import { toZonedDate } from '../../../lib/timezone-utils';
import type {
    CalendarLayerItem, CalendarLayerMarker, CalendarLayerWindow,
} from '../../../plugins/calendar-layer';

/** A window segment inside one local day, fed to RBC as a background event. */
export interface LayerWindowEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    /** True when this segment carries a window over from the previous day. */
    continued: boolean;
    layer: CalendarLayerWindow;
}

/** A marker resolved to the user's timezone: its local day and minute of day. */
export interface ZonedLayerMarker {
    id: string;
    dayKey: string;
    minuteOfDay: number;
    marker: CalendarLayerMarker;
}

/** Hard stop so a malformed multi-month window can never spin the grid. */
const MAX_SEGMENTS = 62;

/** Layer events carry `layer`; calendar events carry `resource`. */
export function isLayerEvent<T extends object>(event: T | LayerWindowEvent): event is LayerWindowEvent {
    return 'layer' in event;
}

/** RBC lays the grid out in whole minutes, so a shorter segment draws zero-height. */
const MIN_SEGMENT_MS = 60_000;

/**
 * Split [start, end) at each local midnight of the dates' own timezone.
 * Segments shorter than a minute are dropped: RBC renders them as an
 * invisible zero-height band at midnight. A segment that runs to midnight
 * ends at the last instant of its own day (23:59:59.999, RBC's default
 * column `max`): RBC's time grid keeps an event in every column whose day is
 * <= the end's day, so an end of 00:00 next day leaks a 0px band into the
 * next column. Labels/tooltips use the window's real end, not this one.
 */
export function splitAtMidnight(start: Date, end: Date): Array<{ start: Date; end: Date }> {
    const out: Array<{ start: Date; end: Date }> = [];
    let cursor = start;
    for (let guard = 0; cursor < end && guard < MAX_SEGMENTS; guard += 1) {
        const midnight = addDays(startOfDay(cursor), 1);
        const segEnd = midnight < end ? midnight : end;
        if (segEnd.getTime() - cursor.getTime() >= MIN_SEGMENT_MS) {
            out.push({ start: cursor, end: segEnd.getTime() === midnight.getTime() ? new Date(midnight.getTime() - 1) : segEnd });
        }
        cursor = segEnd;
    }
    return out;
}

function windowSegments(win: CalendarLayerWindow, tz: string): LayerWindowEvent[] {
    const parts = splitAtMidnight(toZonedDate(win.start, tz), toZonedDate(win.end, tz));
    return parts.map((part, idx) => ({
        id: idx === 0 ? win.id : `${win.id}#${idx}`,
        title: idx === 0 ? win.label : `${win.label} (cont.)`,
        start: part.start,
        end: part.end,
        continued: idx > 0,
        layer: win,
    }));
}

/** Window items → zoned, per-day background events. Markers are ignored. */
export function toLayerBackgroundEvents(items: readonly CalendarLayerItem[], tz: string): LayerWindowEvent[] {
    return items.flatMap((item) => (item.kind === 'window' ? windowSegments(item, tz) : []));
}

/** Marker items → their local day key and minute of day in `tz`. */
export function zonedMarkers(items: readonly CalendarLayerItem[], tz: string): ZonedLayerMarker[] {
    return items.flatMap((item) => {
        if (item.kind !== 'marker') return [];
        const at = toZonedDate(item.at, tz);
        if (Number.isNaN(at.getTime())) return [];
        return [{ id: item.id, dayKey: format(at, 'yyyy-MM-dd'), minuteOfDay: at.getHours() * 60 + at.getMinutes(), marker: item }];
    });
}

/** The markers that fall on the same local day as an RBC day column. */
export function markersForColumn(markers: readonly ZonedLayerMarker[], columnDate: Date): ZonedLayerMarker[] {
    const key = format(columnDate, 'yyyy-MM-dd');
    return markers.filter((m) => m.dayKey === key);
}

/** Markers drawn at the same spot of a day column; one glyph lists them all. */
export interface ZonedLayerMarkerGroup {
    key: string;
    head: ZonedLayerMarker;
    rest: ZonedLayerMarker[];
}

/** Group markers that land on the same local day + minute, so none hides another. */
export function groupCoincidentMarkers(markers: readonly ZonedLayerMarker[]): ZonedLayerMarkerGroup[] {
    const groups = new Map<string, ZonedLayerMarkerGroup>();
    const sorted = [...markers].sort((a, b) => Date.parse(a.marker.at) - Date.parse(b.marker.at));
    for (const m of sorted) {
        const key = `${m.dayKey}@${m.minuteOfDay}`;
        const group = groups.get(key);
        if (group) group.rest.push(m);
        else groups.set(key, { key, head: m, rest: [] });
    }
    return [...groups.values()];
}
