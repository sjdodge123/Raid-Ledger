/**
 * The Pelican calendar layer's heavy half (ROK-1774). Loaded with a dynamic
 * `import()` from the thin `usePelicanCalendarItems` hook's query functions, so
 * the fetchers, the response schemas and the item mapping land in a lazy chunk
 * instead of the entry chunk (the hook itself is registered at boot).
 */
import {
    GameServerCalendarResponseSchema,
    GameServerStatusResponseSchema,
    type GameServerCalendarItemDto,
    type GameServerStatusDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import type { CalendarLayerRange } from '../../calendar-layer';

export { fetchGameRegistry } from '../../../lib/api/games-api';
export { toPelicanLayerItems } from './pelican-calendar-items.helpers';

export const GAME_SERVERS_CALENDAR_PATH = '/game-servers/calendar';
export const GAME_SERVERS_STATUS_PATH = '/game-servers/status';

/** Schedule items for the visible range. `gameIds` is never sent (spec Q3). */
export async function fetchServerCalendar(range: CalendarLayerRange): Promise<GameServerCalendarItemDto[]> {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    const res = await fetchApi(`${GAME_SERVERS_CALENDAR_PATH}?${qs.toString()}`, {}, GameServerCalendarResponseSchema);
    return res.data;
}

/** Live state for every mapped server. */
export async function fetchServerStatus(): Promise<GameServerStatusDto[]> {
    return (await fetchApi(GAME_SERVERS_STATUS_PATH, {}, GameServerStatusResponseSchema)).data;
}
