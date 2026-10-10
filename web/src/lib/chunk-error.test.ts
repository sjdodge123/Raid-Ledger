/**
 * ROK-1763: the stale-chunk matcher must recognise every engine's wording for
 * a failed dynamic import — WebKit's included — and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { isChunkLoadError } from './chunk-error';

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
