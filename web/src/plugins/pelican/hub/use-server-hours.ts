/**
 * ROK-1876 L3 — the next seven days of `GET /game-servers/calendar` for the
 * server hub's hours widget. The fetcher is `import()`ed, as the calendar
 * layer's hook does, so its schemas stay out of the entry chunk. The range
 * is fixed per mount so the query key is stable across renders.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GameServerCalendarItemDto } from '@raid-ledger/contract';
import { hoursRange } from './server-hours.helpers';

export const SERVER_HOURS_STALE_MS = 60_000;

/** All servers' items in range (the endpoint has no server filter); the widget filters by `serverKey`. */
export function useServerHoursItems(enabled: boolean) {
    const [range] = useState(() => hoursRange(Date.now()));
    return useQuery<GameServerCalendarItemDto[]>({
        queryKey: ['game-servers', 'calendar', range.from, range.to],
        queryFn: async () => (await import('../calendar/pelican-calendar.lazy')).fetchServerCalendar(range),
        enabled,
        staleTime: SERVER_HOURS_STALE_MS,
    });
}
