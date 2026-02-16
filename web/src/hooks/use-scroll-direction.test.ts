import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollDirection } from './use-scroll-direction';

/* ────────────────────────────────────────────────────────── */
/*  Helpers                                                   */
/* ────────────────────────────────────────────────────────── */

let matchMediaMatches = true; // true = mobile viewport

beforeEach(() => {
    matchMediaMatches = true;

    // Stub rAF to fire synchronously (via vi.stubGlobal, NOT a jsdom default)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
    });

    // Stub matchMedia
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
        matches: matchMediaMatches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })));

    // Reset scrollY
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

function simulateScroll(y: number) {
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
    window.dispatchEvent(new Event('scroll'));
}

/* ────────────────────────────────────────────────────────── */
/*  Tests                                                     */
/* ────────────────────────────────────────────────────────── */

describe('useScrollDirection', () => {
    it('returns null initially', () => {
        const { result } = renderHook(() => useScrollDirection());
        expect(result.current).toBeNull();
    });

    it('returns "down" after scrolling past threshold (100px)', () => {
        const { result } = renderHook(() => useScrollDirection());

        act(() => {
            simulateScroll(50);
        });
        // Still below threshold
        expect(result.current).toBeNull();

        act(() => {
            simulateScroll(150);
        });
        expect(result.current).toBe('down');
    });

    it('returns "up" on any upward scroll', () => {
        const { result } = renderHook(() => useScrollDirection());

        act(() => {
            simulateScroll(200);
        });
        expect(result.current).toBe('down');

        act(() => {
            simulateScroll(180);
        });
        expect(result.current).toBe('up');
    });

    it('does not attach listener on desktop (matchMedia does not match)', () => {
        matchMediaMatches = false;
        // Re-stub so the hook gets the new value
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })));

        const addSpy = vi.spyOn(window, 'addEventListener');
        renderHook(() => useScrollDirection());

        const scrollCalls = addSpy.mock.calls.filter(([event]) => event === 'scroll');
        expect(scrollCalls).toHaveLength(0);
    });

    it('cleans up scroll listener on unmount', () => {
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useScrollDirection());

        unmount();

        const scrollCalls = removeSpy.mock.calls.filter(([event]) => event === 'scroll');
        expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
    });
});
