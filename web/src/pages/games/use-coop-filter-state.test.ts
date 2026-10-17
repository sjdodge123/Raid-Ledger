/**
 * TDB:316 — `useCoopFilterState` is a thin `useSessionState` wrapper. Pins the
 * two behaviours the games page relies on: filters survive the detail-page
 * round trip (unmount → remount), and an untrusted stored blob can never
 * reach the filter pipeline in an unexpected shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoopFilterState } from './use-coop-filter-state';

const KEY = 'games-coop-filters';

beforeEach(() => {
    window.sessionStorage.clear();
});

describe('useCoopFilterState', () => {
    it('starts empty when nothing is stored', () => {
        const { result } = renderHook(() => useCoopFilterState());
        expect(result.current[0]).toEqual({});
    });

    it('restores the filters after an unmount / remount', () => {
        const first = renderHook(() => useCoopFilterState());
        act(() => first.result.current[1]({ couchCoop: true, onlineMinPlayers: 4 }));
        first.unmount();

        const second = renderHook(() => useCoopFilterState());
        expect(second.result.current[0]).toEqual({ couchCoop: true, onlineMinPlayers: 4 });
    });

    it('falls back to empty filters when the stored blob is not valid JSON', () => {
        window.sessionStorage.setItem(KEY, '{not json');
        const { result } = renderHook(() => useCoopFilterState());
        expect(result.current[0]).toEqual({});
        // Documented eviction: a bad blob must not be re-read on every mount.
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it('falls back to empty filters when the stored blob is not an object', () => {
        window.sessionStorage.setItem(KEY, JSON.stringify('couchCoop'));
        const { result } = renderHook(() => useCoopFilterState());
        expect(result.current[0]).toEqual({});
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it('keeps only known keys with the right type from a tampered blob', () => {
        window.sessionStorage.setItem(
            KEY,
            JSON.stringify({ lanCoop: true, splitscreen: 'yes', onlineMinPlayers: -2, evil: 1 }),
        );
        const { result } = renderHook(() => useCoopFilterState());
        expect(result.current[0]).toEqual({ lanCoop: true });
    });
});
