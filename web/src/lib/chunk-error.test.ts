/**
 * ROK-1763: the stale-chunk matcher must recognise every engine's wording for
 * a failed dynamic import — WebKit's included — and nothing else.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    isChunkLoadError,
    claimChunkReload,
    claimChunkReloadFor,
    resetChunkReloadPageState,
    CHUNK_RELOAD_AWAIT_MS,
} from './chunk-error';

describe('isChunkLoadError', () => {
    it('matches WebKit (Safari / iPadOS Chrome) failed module import', () => {
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    });

    it.each([
        ['Chrome', 'Failed to fetch dynamically imported module: https://x/assets/a.js'],
        ['Firefox', 'error loading dynamically imported module: https://x/assets/a.js'],
        ['CSS chunk', 'Loading CSS chunk 3 failed'],
        ['JS chunk', 'Loading chunk 12 failed.'],
        ['Vite CSS preload', 'Unable to preload CSS for /assets/calendar-page-abc123.css'],
        ['Vite CSS preload (any case)', 'UNABLE TO PRELOAD CSS FOR /assets/event-detail-page-x.css'],
    ])('matches the %s wording', (_engine, message) => {
        expect(isChunkLoadError(new TypeError(message))).toBe(true);
    });

    it('does not match an unrelated runtime error', () => {
        expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    });

    it('does not match a non-Error value carrying the WebKit text', () => {
        expect(isChunkLoadError('Importing a module script failed.')).toBe(false);
    });
});

describe('claimChunkReload', () => {
    afterEach(() => vi.restoreAllMocks());

    it('never auto-reloads when storage throws (no guard possible)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(claimChunkReload(1_000_000)).toBe(false);
    });

    it('blocks a second reload 30s after the first (slow-device cycle)', () => {
        sessionStorage.clear();
        expect(claimChunkReload(1_000_000)).toBe(true);
        expect(claimChunkReload(1_030_000)).toBe(false);
    });
});

describe('claimChunkReloadFor after a route-level claim (ROK-2251)', () => {
    it('a widget failing alongside a route reload waits quietly, then falls back once the await window passes', () => {
        sessionStorage.clear();
        resetChunkReloadPageState();
        const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
        expect(claimChunkReload()).toBe(true);
        now.mockReturnValue(5_001_000);
        const sibling = new TypeError('Failed to fetch dynamically imported module: /assets/w.js');
        expect(claimChunkReloadFor(sibling), 'a widget failing with the route reload must wait for it').toBe('awaiting-reload');
        now.mockReturnValue(5_000_000 + CHUNK_RELOAD_AWAIT_MS);
        const late = new TypeError('Failed to fetch dynamically imported module: /assets/w2.js');
        expect(claimChunkReloadFor(late), 'past the await window the reload was cancelled').toBe('none');
        vi.restoreAllMocks();
    });
});
