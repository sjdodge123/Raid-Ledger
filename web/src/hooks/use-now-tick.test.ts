/**
 * ROK-1479 D11 — the single shared countdown tick.
 *
 * TDD: `./use-now-tick` does not exist yet, so this file fails at import.
 *
 * What these cases pin (spec D11 / AC5 item 4):
 *   • ONE interval per mounted consumer, however many instants it tracks —
 *     the per-row interval is the "re-render storm" the decision forbids;
 *   • 15 s normally, dropping to 5 s only while the SOONEST tracked instant is
 *     under two minutes away;
 *   • NO interval at all when nothing is tracked (the group page mounts the
 *     strip's hook on every group, most of which have no `now` members);
 *   • the interval is cleared on unmount.
 *
 * `vi.getTimerCount()` is the assertion rather than a spy on `setInterval`,
 * because the claim is about how many timers are LIVE, not how many times the
 * global was called — a hook that creates and immediately replaces a timer
 * would pass a call-count assertion and still leak.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    useNowTick,
    NOW_TICK_SLOW_MS,
    NOW_TICK_FAST_MS,
} from './use-now-tick';

const BASE = new Date('2026-09-05T12:00:00.000Z');

/** An ISO instant `minutes` from the frozen clock. */
function inMinutes(minutes: number): string {
    return new Date(BASE.getTime() + minutes * 60_000).toISOString();
}

describe('useNowTick', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('mounts exactly one interval for a five-instant list', () => {
        const instants = [
            inMinutes(24),
            inMinutes(9),
            inMinutes(41),
            inMinutes(17),
            inMinutes(58),
        ];
        expect(vi.getTimerCount()).toBe(0);

        renderHook(() => useNowTick(instants));

        expect(vi.getTimerCount()).toBe(1);
    });

    it('returns the current instant and advances it on the slow cadence', () => {
        const { result } = renderHook(() => useNowTick([inMinutes(24)]));
        const first = result.current;
        expect(first).toBe(BASE.getTime());

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_SLOW_MS);
        });

        expect(result.current).toBe(first + NOW_TICK_SLOW_MS);
    });

    it('does not tick before the slow cadence elapses', () => {
        const { result } = renderHook(() => useNowTick([inMinutes(24)]));
        const first = result.current;

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_SLOW_MS - 1_000);
        });

        expect(result.current).toBe(first);
    });

    it('drops to the fast cadence while the soonest instant is under two minutes away', () => {
        const { result } = renderHook(() => useNowTick([inMinutes(1.5)]));
        const first = result.current;

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_FAST_MS);
        });

        expect(result.current).toBe(first + NOW_TICK_FAST_MS);
    });

    it('keeps the slow cadence while the soonest instant is beyond two minutes', () => {
        const { result } = renderHook(() => useNowTick([inMinutes(3)]));
        const first = result.current;

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_FAST_MS);
        });

        expect(result.current).toBe(first);
    });

    it('creates NO interval when nothing is tracked', () => {
        const { result } = renderHook(() => useNowTick([]));

        expect(vi.getTimerCount()).toBe(0);
        expect(result.current).toBe(BASE.getTime());
    });

    it('ignores unparseable instants and mounts no interval for a list of them', () => {
        renderHook(() => useNowTick(['not-a-date']));

        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores instants already in the past and mounts no interval for them', () => {
        renderHook(() => useNowTick([inMinutes(-5), inMinutes(-0.5)]));

        expect(vi.getTimerCount()).toBe(0);
    });

    it('counts down to the soonest FUTURE instant, not to a lapsed one', () => {
        // A lapsed instant is permanently inside the fast window, so a hook
        // that still considered it would pick the 5 s cadence here.
        const { result } = renderHook(() =>
            useNowTick([inMinutes(-10), inMinutes(30)]),
        );
        const first = result.current;

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_FAST_MS);
        });

        expect(result.current).toBe(first);
    });

    it('clears the interval on unmount', () => {
        const { unmount } = renderHook(() => useNowTick([inMinutes(24)]));
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('still holds exactly one interval after crossing into the fast window', () => {
        const { result } = renderHook(() => useNowTick([inMinutes(2.5)]));

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_SLOW_MS * 3);
        });

        expect(result.current).toBeGreaterThan(BASE.getTime());
        expect(vi.getTimerCount()).toBe(1);
    });
});
