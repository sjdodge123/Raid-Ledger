/**
 * ROK-1775 — pure bucketing of plugin layer items into the viewer's local days,
 * for the views that draw no bands: the Month glyph tooltip and the Schedule
 * (phone list) rows. A window crossing local midnight counts on EVERY day it
 * touches — however briefly: unlike the Week/Day bands' `splitAtMidnight`,
 * nothing under a minute is pruned here (that pruning is only about drawable
 * band height). A marker counts on its own day. Each bucket is sorted by time.
 */
import { addDays, format, startOfDay } from 'date-fns';
import { toZonedDate } from '../../../lib/timezone-utils';
import type {
    CalendarLayerItem, CalendarLayerMarker, CalendarLayerWindow,
} from '../../../plugins/calendar-layer';
import type { LayerGlyphTip } from './LayerGlyph';

/** One layer item on one local day. */
export interface LayerDayEntry {
    id: string;
    kind: 'window' | 'marker';
    /** Zoned instant the entry sorts at on its day (a carried-over window sorts at 00:00). */
    at: Date;
    tip: LayerGlyphTip;
}

/** `yyyy-MM-dd` (viewer's timezone) → that day's entries, sorted by time. */
export type LayerDayMap = ReadonlyMap<string, readonly LayerDayEntry[]>;

export const NO_LAYER_DAYS: LayerDayMap = new Map();

/** "6:00 PM" — the date's own (zoned) wall clock. */
export function formatLayerClock(date: Date): string {
    return format(date, 'h:mm a');
}

/** "Server up · Valheim Dedicated · 6:00 PM – 2:00 AM" — the window's REAL start/end, on every day it touches. */
export function windowTipTitle(win: CalendarLayerWindow, start: Date, end: Date): string {
    return `${win.label} · ${formatLayerClock(start)} – ${formatLayerClock(end)}`;
}

/** Generous bound on the days one window may span (the widest query is ~3 months). */
const MAX_WINDOW_DAYS = 120;

/** The instant `[start, end)` enters each local day it overlaps: `start`, then every midnight before `end`. */
export function windowDayStarts(start: Date, end: Date): Date[] {
    if (!(end > start)) return [];
    const out = [start];
    let midnight = addDays(startOfDay(start), 1);
    while (midnight < end && out.length < MAX_WINDOW_DAYS) {
        out.push(midnight);
        midnight = addDays(midnight, 1);
    }
    return out;
}

function windowEntries(win: CalendarLayerWindow, tz: string): LayerDayEntry[] {
    const start = toZonedDate(win.start, tz);
    const end = toZonedDate(win.end, tz);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const tip: LayerGlyphTip = { title: windowTipTitle(win, start, end), detail: '' };
    return windowDayStarts(start, end).map((at, idx) => ({ id: `${win.id}#${idx}`, kind: 'window', at, tip }));
}

function markerEntry(marker: CalendarLayerMarker, tz: string): LayerDayEntry[] {
    const at = toZonedDate(marker.at, tz);
    return Number.isNaN(at.getTime()) ? [] : [{ id: marker.id, kind: 'marker', at, tip: marker.tip }];
}

function byTime(a: LayerDayEntry, b: LayerDayEntry): number {
    return a.at.getTime() - b.at.getTime() || a.tip.title.localeCompare(b.tip.title);
}

/** Layer items → per-local-day buckets in `tz`. */
export function groupLayerItemsByDay(items: readonly CalendarLayerItem[], tz: string): LayerDayMap {
    if (items.length === 0) return NO_LAYER_DAYS;
    const days = new Map<string, LayerDayEntry[]>();
    const entries = items.flatMap((item) => (item.kind === 'window' ? windowEntries(item, tz) : markerEntry(item, tz)));
    for (const entry of entries) {
        const key = format(entry.at, 'yyyy-MM-dd');
        const bucket = days.get(key);
        if (bucket) bucket.push(entry);
        else days.set(key, [entry]);
    }
    for (const bucket of days.values()) bucket.sort(byTime);
    return days;
}
