/**
 * Pelican's calendar layer hook (ROK-1774 L3) — `CalendarLayer.useItems`.
 * Two queries: the schedule items for the visible range and the live status
 * (refetched every 60s, AC10). `gameIds` is never sent (spec Q3): the game
 * filter applies client-side, so toggling it never refetches. Every query is
 * disabled when `enabled` is false (inactive plugin, month/schedule view).
 *
 * This hook is registered at boot, so it stays THIN: the query functions
 * `import()` the fetchers, schemas and mapping (`pelican-calendar.lazy.ts`),
 * which keeps that code out of the entry chunk. The hook calls the same hooks
 * in the same order on every render.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GameServerCalendarItemDto, GameServerStatusDto } from '@raid-ledger/contract';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { useGameFilterStore, type GameInfo } from '../../../stores/game-filter-store';
import type { CalendarLayerItem, CalendarLayerRange } from '../../calendar-layer';

export const STATUS_REFETCH_MS = 60_000;

const NO_ITEMS: readonly CalendarLayerItem[] = Object.freeze([]);

type LazyModule = typeof import('./pelican-calendar.lazy');
let lazyModule: LazyModule | undefined;

/** Loads (once) the heavy half; every query function goes through here. */
async function loadLazy(): Promise<LazyModule> {
    lazyModule ??= await import('./pelican-calendar.lazy');
    return lazyModule;
}

function useServerCalendar(range: CalendarLayerRange, enabled: boolean) {
    return useQuery<GameServerCalendarItemDto[]>({
        queryKey: ['game-servers', 'calendar', range.from, range.to],
        queryFn: async () => (await loadLazy()).fetchServerCalendar(range),
        enabled,
        staleTime: 60_000,
    });
}

function useServerStatus(enabled: boolean) {
    return useQuery<GameServerStatusDto[]>({
        queryKey: ['game-servers', 'status'],
        queryFn: async () => (await loadLazy()).fetchServerStatus(),
        enabled,
        refetchInterval: enabled ? STATUS_REFETCH_MS : false,
    });
}

/** id → slug, only needed (and only fetched) while a game filter is active. Shares `useGameRegistry`'s cache key. */
function useSlugById(enabled: boolean): ReadonlyMap<number, string> {
    const { data } = useQuery({
        queryKey: ['game-registry'],
        queryFn: async () => (await loadLazy()).fetchGameRegistry(),
        enabled,
        staleTime: 1000 * 60 * 10,
    });
    return useMemo(() => new Map((data?.data ?? []).map((g) => [g.id, g.slug])), [data]);
}

/**
 * The filter the layer applies, or `undefined` for "all games". A filter is
 * active only when a known game is deselected — the calendar's Filters badge
 * (`countHiddenGames > 0`). With every known game selected, every server shows,
 * including one whose game the registry does not know (spec Q5).
 */
export function activeGameFilter(
    selectedGames: ReadonlySet<string> | undefined,
    knownGames: readonly GameInfo[],
): ReadonlySet<string> | undefined {
    if (selectedGames === undefined) return undefined;
    return knownGames.some((g) => !selectedGames.has(g.slug)) ? selectedGames : undefined;
}

export function usePelicanCalendarItems(
    range: CalendarLayerRange,
    selectedGames: ReadonlySet<string> | undefined,
    enabled: boolean,
): readonly CalendarLayerItem[] {
    const knownGames = useGameFilterStore((s) => s.allKnownGames);
    const filter = activeGameFilter(selectedGames, knownGames);
    const calendar = useServerCalendar(range, enabled);
    const status = useServerStatus(enabled);
    const slugById = useSlugById(enabled && filter !== undefined);
    const tz = useTimezoneStore((s) => s.resolved);
    const items = calendar.data;
    const statuses = status.data;
    const now = status.dataUpdatedAt;
    return useMemo(() => {
        // Calendar data only exists after its query function loaded the lazy module.
        if (!enabled || !items || items.length === 0 || !lazyModule) return NO_ITEMS;
        return lazyModule.toPelicanLayerItems({ items, statuses: statuses ?? [], slugById, selectedGames: filter, tz, now });
    }, [enabled, items, statuses, slugById, filter, tz, now]);
}
