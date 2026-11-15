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

/** Phone viewport, frozen clock, synchronous rAF; a fresh store module per test. */
async function loadStore(): Promise<HookModule> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    vi.spyOn(window, 'matchMedia').mockImplementation(phoneMediaQuery);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
    });
    setScrollY(0);
    vi.resetModules();
    return import('./use-scroll-direction');
}

function restoreGlobals(): void {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setScrollY(0);
}

describe('useScrollDirection — app-started scrolls (ignoreScrollFor)', () => {
    let mod: HookModule;

    beforeEach(async () => {
        mod = await loadStore();
    });

    afterEach(restoreGlobals);

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

});

describe('useScrollDirection — a long app-started scroll stretches the window (td5 MINOR)', () => {
    let mod: HookModule;

    beforeEach(async () => {
        mod = await loadStore();
    });

    afterEach(restoreGlobals);

    it('stretches the window while a smooth scroll keeps sending frames past its end', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        const start = Date.now();
        act(() => mod.ignoreScrollFor(1000));
        for (const [at, y] of [[900, 300], [1000, 400], [1100, 500], [1200, 600]] as const) {
            vi.setSystemTime(start + at);
            scrollTo(y);
        }
        expect(result.current).toBeNull();
    });

    it('stops stretching at the cap, so a continuous scroll counts again after ~2 s', () => {
        const { result } = renderHook(() => mod.useScrollDirection());
        const start = Date.now();
        act(() => mod.ignoreScrollFor(1000));
        for (let at = 100; at <= 1900; at += 100) {
            vi.setSystemTime(start + at);
            scrollTo(at);
        }
        expect(result.current).toBeNull();
        vi.setSystemTime(start + 2000);
        scrollTo(2000);
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
