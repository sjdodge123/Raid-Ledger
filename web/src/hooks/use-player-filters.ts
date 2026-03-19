/**
 * Central hook for player filter state + URL sync (ROK-821).
 * Reads from and writes to URL search params for shareable filter state.
 */
import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** All filter values for the players page. */
export interface PlayerFilters {
    gameId?: number;
    sources?: string[];
    playHistory?: string;
    playtimeMin?: number;
    role?: string;
}

/** API-ready params for getPlayers(). */
export interface PlayerApiParams {
    gameId?: number;
    sources?: string;
    playHistory?: string;
    playtimeMin?: number;
    role?: string;
}

/** Return type from usePlayerFilters. */
export interface UsePlayerFiltersResult {
    filters: PlayerFilters;
    setFilter: <K extends keyof PlayerFilters>(key: K, value: PlayerFilters[K]) => void;
    clearAll: () => void;
    activeFilterCount: number;
    apiParams: PlayerApiParams;
    isOpen: boolean;
    toggleOpen: () => void;
}

/** Parse numeric URL param, returning undefined for invalid values. */
function parseIntParam(value: string | null): number | undefined {
    if (!value) return undefined;
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse comma-separated sources from URL param. */
function parseSourcesParam(value: string | null): string[] | undefined {
    if (!value) return undefined;
    const parts = value.split(',').filter(Boolean);
    return parts.length > 0 ? parts : undefined;
}

/** Read all filter values from URL search params. Supports legacy `source` (singular) param. */
function readFiltersFromParams(sp: URLSearchParams): PlayerFilters {
    const sources = parseSourcesParam(sp.get('sources')) ?? parseSourcesParam(sp.get('source'));
    return {
        gameId: parseIntParam(sp.get('gameId')),
        sources,
        playHistory: sp.get('playHistory') || undefined,
        playtimeMin: parseIntParam(sp.get('playtimeMin')),
        role: sp.get('role') || undefined,
    };
}

/** Count how many filters are active (sources excluded — it refines the game filter, not a standalone filter). */
function countActiveFilters(f: PlayerFilters): number {
    let count = 0;
    if (f.gameId) count++;
    if (f.playHistory) count++;
    if (f.playtimeMin) count++;
    if (f.role) count++;
    return count;
}

/** All source values joined for the API (must match GameInterestSourceValues in contract). */
const ALL_SOURCES = 'manual,discord,steam_library,steam_wishlist';

/**
 * Central hook managing all player filter state + URL sync.
 * @returns Filter state, setters, and API-ready params.
 */
export function usePlayerFilters(): UsePlayerFiltersResult {
    const [searchParams, setSearchParams] = useSearchParams();
    const [isOpen, setIsOpen] = useState(() => countActiveFilters(readFiltersFromParams(searchParams)) > 0);

    const filters = useMemo(() => readFiltersFromParams(searchParams), [searchParams]);
    const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

    const setFilter = useCallback(<K extends keyof PlayerFilters>(key: K, value: PlayerFilters[K]) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('source');
            if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) next.delete(key);
            else if (Array.isArray(value)) next.set(key, value.join(','));
            else next.set(key, String(value));
            return next;
        }, { replace: true });
    }, [setSearchParams]);
    const clearAll = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);
    const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);
    const apiParams = useMemo((): PlayerApiParams => ({
        gameId: filters.gameId, sources: filters.sources?.join(',') || (filters.gameId ? ALL_SOURCES : undefined),
        playHistory: filters.playHistory, playtimeMin: filters.playtimeMin, role: filters.role,
    }), [filters]);

    return { filters, setFilter, clearAll, activeFilterCount, apiParams, isOpen, toggleOpen };
}
