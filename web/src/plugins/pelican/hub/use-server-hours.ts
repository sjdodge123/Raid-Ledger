/**
 * ROK-1876 L3 — the next seven days of `GET /game-servers/calendar` for the
 * server hub's hours widget, plus the clock it is read against.
 *
 * `now` ticks every minute while the widget is mounted (`useNow`), so "open
 * now / opens at" and the day rows follow the wall clock instead of freezing
 * at fetch time (Codex r1 P2). The range is anchored to the hour, so the
 * query key is stable across ticks and remounts, and it advances (refetching
 * the schedule) once an hour; `keepPreviousData` holds the rows across that
 * hand-off instead of flashing "Loading hours…". The query itself is the
 * calendar layer's (`serverCalendarQuery`), so the key and fetcher live once.
 */
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNow } from '../../../hooks/use-now';
import { serverCalendarQuery } from '../calendar/use-pelican-calendar-items';
import { hoursRange } from './server-hours.helpers';

/** How often the card re-reads the clock. */
export const SERVER_HOURS_TICK_MS = 60_000;
/** The range (and so the query key) moves on this step; each move refetches. */
export const SERVER_HOURS_RANGE_STEP_MS = 3_600_000;

/** All servers' items in range (the endpoint has no server filter; the widget filters by `serverKey`) and a ticking `now`. */
export function useServerHours(enabled: boolean) {
    const now = useNow(SERVER_HOURS_TICK_MS);
    const anchor = Math.floor(now / SERVER_HOURS_RANGE_STEP_MS) * SERVER_HOURS_RANGE_STEP_MS;
    const range = useMemo(() => hoursRange(anchor), [anchor]);
    const query = useQuery({ ...serverCalendarQuery(range), enabled, placeholderData: keepPreviousData });
    return { query, now };
}
