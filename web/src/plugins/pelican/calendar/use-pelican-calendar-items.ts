/**
 * Pelican's calendar layer hook (ROK-1774 L3) — `CalendarLayer.useItems`.
 * Two queries: the schedule items for the visible range and the live status
 * (refetched every 60s, AC10). `gameIds` is never sent (spec Q3): the game
 * filter applies client-side, so toggling it never refetches. Every query is
 * disabled when `enabled` is false (inactive plugin, month/schedule view).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    GameServerCalendarResponseSchema,
    GameServerStatusResponseSchema,
    type GameServerCalendarItemDto,
    type GameServerStatusDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { fetchGameRegistry } from '../../../lib/api/games-api';
import { useTimezoneStore } from '../../../stores/timezone-store';
import type { CalendarLayerItem, CalendarLayerRange } from '../../calendar-layer';
import { toPelicanLayerItems } from './pelican-calendar-items.helpers';

export const GAME_SERVERS_CALENDAR_PATH = '/game-servers/calendar';
export const GAME_SERVERS_STATUS_PATH = '/game-servers/status';
export const STATUS_REFETCH_MS = 60_000;

const NO_ITEMS: readonly CalendarLayerItem[] = Object.freeze([]);

function useServerCalendar(range: CalendarLayerRange, enabled: boolean) {
    return useQuery<GameServerCalendarItemDto[]>({
        queryKey: ['game-servers', 'calendar', range.from, range.to],
        queryFn: async () => {
            const qs = new URLSearchParams({ from: range.from, to: range.to });
            const res = await fetchApi(`${GAME_SERVERS_CALENDAR_PATH}?${qs.toString()}`, {}, GameServerCalendarResponseSchema);
            return res.data;
        },
        enabled,
        staleTime: 60_000,
    });
}

function useServerStatus(enabled: boolean) {
    return useQuery<GameServerStatusDto[]>({
        queryKey: ['game-servers', 'status'],
        queryFn: async () => (await fetchApi(GAME_SERVERS_STATUS_PATH, {}, GameServerStatusResponseSchema)).data,
        enabled,
        refetchInterval: enabled ? STATUS_REFETCH_MS : false,
    });
}

/** id → slug, only needed (and only fetched) while a game filter is active. Shares `useGameRegistry`'s cache key. */
function useSlugById(enabled: boolean): ReadonlyMap<number, string> {
    const { data } = useQuery({
        queryKey: ['game-registry'],
        queryFn: fetchGameRegistry,
        enabled,
        staleTime: 1000 * 60 * 10,
    });
    return useMemo(() => new Map((data?.data ?? []).map((g) => [g.id, g.slug])), [data]);
}

export function usePelicanCalendarItems(
    range: CalendarLayerRange,
    selectedGames: ReadonlySet<string> | undefined,
    enabled: boolean,
): readonly CalendarLayerItem[] {
    const calendar = useServerCalendar(range, enabled);
    const status = useServerStatus(enabled);
    const slugById = useSlugById(enabled && selectedGames !== undefined);
    const tz = useTimezoneStore((s) => s.resolved);
    const items = calendar.data;
    const statuses = status.data;
    const now = status.dataUpdatedAt;
    return useMemo(() => {
        if (!enabled || !items || items.length === 0) return NO_ITEMS;
        return toPelicanLayerItems({ items, statuses: statuses ?? [], slugById, selectedGames, tz, now });
    }, [enabled, items, statuses, slugById, selectedGames, tz, now]);
}
