/** ROK-1901 review m1/m2: the idle prefetch warms event routes AND drawer chunks, once, and respects Data Saver. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prefetchDeferredChunksOnIdle, resetIdlePrefetchForTests } from './idle-prefetch';

const { prefetchEventRoutes, prefetchMoreDrawerContent, getAuthMethod } = vi.hoisted(() => ({
    prefetchEventRoutes: vi.fn(),
    prefetchMoreDrawerContent: vi.fn(),
    getAuthMethod: vi.fn<() => string | null>(),
}));
vi.mock('./lazy-routes', () => ({ prefetchEventRoutes }));
vi.mock('./components/layout/more-drawer-chunks', () => ({ prefetchMoreDrawerContent }));
vi.mock('./lib/api/silent-reauth', () => ({ getAuthMethod }));

describe('prefetchDeferredChunksOnIdle', () => {
    beforeEach(() => {
        resetIdlePrefetchForTests();
        prefetchEventRoutes.mockClear();
        prefetchMoreDrawerContent.mockClear();
        getAuthMethod.mockReset().mockReturnValue('discord');
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        Reflect.deleteProperty(navigator, 'connection');
    });

    it('waits for idle, then warms the event routes and the More drawer chunks', () => {
        prefetchDeferredChunksOnIdle();
        expect(prefetchEventRoutes, 'must not fetch before idle').not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(prefetchEventRoutes).toHaveBeenCalledTimes(1);
        expect(prefetchMoreDrawerContent).toHaveBeenCalledTimes(1);
    });

    it('runs only once per page load', () => {
        prefetchDeferredChunksOnIdle();
        prefetchDeferredChunksOnIdle();
        vi.runAllTimers();
        expect(prefetchEventRoutes).toHaveBeenCalledTimes(1);
    });

    it('skips everything under Data Saver', () => {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
        prefetchDeferredChunksOnIdle();
        vi.runAllTimers();
        expect(prefetchEventRoutes).not.toHaveBeenCalled();
        expect(prefetchMoreDrawerContent).not.toHaveBeenCalled();
    });

    it('skips everything for a logged-out visitor (no auth-method marker)', () => {
        getAuthMethod.mockReturnValue(null);
        prefetchDeferredChunksOnIdle();
        vi.runAllTimers();
        expect(prefetchEventRoutes, 'logged-out visitors must not download prefetched chunks').not.toHaveBeenCalled();
        expect(prefetchMoreDrawerContent).not.toHaveBeenCalled();
    });

    it('prefetches for a signed-in user (any auth method)', () => {
        getAuthMethod.mockReturnValue('magic');
        prefetchDeferredChunksOnIdle();
        vi.runAllTimers();
        expect(prefetchEventRoutes).toHaveBeenCalledTimes(1);
        expect(prefetchMoreDrawerContent).toHaveBeenCalledTimes(1);
    });
});
