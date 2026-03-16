/**
 * Tests for usePlayerFilters hook (ROK-821).
 * Verifies filter state management and URL sync.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { usePlayerFilters } from './use-player-filters';

function wrapper(initialEntries: string[] = ['/players']) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
    };
}

describe('usePlayerFilters', () => {
    it('returns zero activeFilterCount with no URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(),
        });
        expect(result.current.activeFilterCount).toBe(0);
    });

    it('reads gameId from URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?gameId=42']),
        });
        expect(result.current.filters.gameId).toBe(42);
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('reads sources from URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?sources=manual,discord']),
        });
        expect(result.current.filters.sources).toEqual(['manual', 'discord']);
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('reads role from URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?role=admin']),
        });
        expect(result.current.filters.role).toBe('admin');
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('reads playtimeMin from URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?playtimeMin=120']),
        });
        expect(result.current.filters.playtimeMin).toBe(120);
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('reads playHistory from URL params', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?playHistory=played_recently']),
        });
        expect(result.current.filters.playHistory).toBe('played_recently');
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('counts multiple active filters', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?gameId=1&sources=manual&role=admin']),
        });
        expect(result.current.activeFilterCount).toBe(3);
    });

    it('setFilter updates a filter value', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(),
        });
        act(() => {
            result.current.setFilter('role', 'operator');
        });
        expect(result.current.filters.role).toBe('operator');
        expect(result.current.activeFilterCount).toBe(1);
    });

    it('clearAll resets all filters', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?gameId=1&role=admin&sources=manual']),
        });
        act(() => {
            result.current.clearAll();
        });
        expect(result.current.activeFilterCount).toBe(0);
        expect(result.current.filters.gameId).toBeUndefined();
        expect(result.current.filters.role).toBeUndefined();
    });

    it('builds apiParams correctly', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?gameId=42&sources=manual,discord&playtimeMin=60&playHistory=played_recently&role=admin']),
        });
        const params = result.current.apiParams;
        expect(params.gameId).toBe(42);
        expect(params.sources).toBe('manual,discord');
        expect(params.playtimeMin).toBe(60);
        expect(params.playHistory).toBe('played_recently');
        expect(params.role).toBe('admin');
    });

    it('apiParams omits undefined values', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(),
        });
        expect(result.current.apiParams.gameId).toBeUndefined();
        expect(result.current.apiParams.sources).toBeUndefined();
        expect(result.current.apiParams.role).toBeUndefined();
    });

    it('toggleOpen toggles the panel open state', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(),
        });
        expect(result.current.isOpen).toBe(false);
        act(() => {
            result.current.toggleOpen();
        });
        expect(result.current.isOpen).toBe(true);
        act(() => {
            result.current.toggleOpen();
        });
        expect(result.current.isOpen).toBe(false);
    });

    it('ignores invalid gameId in URL', () => {
        const { result } = renderHook(() => usePlayerFilters(), {
            wrapper: wrapper(['/players?gameId=abc']),
        });
        expect(result.current.filters.gameId).toBeUndefined();
        expect(result.current.activeFilterCount).toBe(0);
    });
});
