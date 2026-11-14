import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type HookModule = typeof import('./use-scroll-direction');

function phoneMediaQuery(query: string): MediaQueryList {
    return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    };
}

function setScrollY(y: number): void {
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
}

/** Moves the mocked window.scrollY and fires one scroll event. */
function scrollTo(y: number): void {
    act(() => {
        setScrollY(y);
        window.dispatchEvent(new Event('scroll'));
    });
}

describe('useScrollDirection — app-started scrolls (ignoreScrollFor)', () => {
    let mod: HookModule;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
        vi.spyOn(window, 'matchMedia').mockImplementation(phoneMediaQuery);
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
            cb(0);
            return 0;
        });
        setScrollY(0);
        vi.resetModules();
        mod = await import('./use-scroll-direction');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        setScrollY(0);
    });

    it('reads a plain jump past the threshold as a user scroll down (control)', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        scrollTo(500);
        expect(result.current).toBe('down');
    });

    it('leaves the direction unchanged while an app-started scroll runs', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        act(() => mod.ignoreScrollFor(1000));
        scrollTo(500);
        expect(result.current).toBeNull();
    });

    it('reports user scrolls again once the window ends, from the resynced position', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        act(() => mod.ignoreScrollFor(1000));
        scrollTo(500);
        vi.setSystemTime(Date.now() + 1001);
        scrollTo(450);
        expect(result.current).toBe('up');
        scrollTo(600);
        expect(result.current).toBe('down');
    });

    it('a shorter later call does not cut an earlier, longer window short', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        act(() => mod.ignoreScrollFor(1000));
        act(() => mod.ignoreScrollFor(100));
        vi.setSystemTime(Date.now() + 500);
        scrollTo(500);
        expect(result.current).toBeNull();
    });
});
