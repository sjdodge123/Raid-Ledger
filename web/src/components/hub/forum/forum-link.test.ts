/** ROK-1175 — the `?thread=<id>#forum` deep-link helpers. */
import { describe, it, expect } from 'vitest';
import { forumThreadHref, replyIdFromSearch, threadIdFromSearch } from './forum-link';

describe('forum-link', () => {
    it('reads a positive integer ?thread= and rejects junk', () => {
        expect(threadIdFromSearch('?thread=42')).toBe(42);
        expect(threadIdFromSearch('?thread=0'), 'zero is not an id').toBeNull();
        expect(threadIdFromSearch('?thread=4x'), 'non-digits are not an id').toBeNull();
        expect(threadIdFromSearch('?thread=-3')).toBeNull();
        expect(threadIdFromSearch('')).toBeNull();
    });

    it('reads ?reply= the same way', () => {
        expect(replyIdFromSearch('?thread=4&reply=9')).toBe(9);
        expect(replyIdFromSearch('?thread=4')).toBeNull();
    });

    it('builds the in-page href with the #forum hash, reply optional', () => {
        expect(forumThreadHref(12)).toBe('?thread=12#forum');
        expect(forumThreadHref(12, 30)).toBe('?thread=12&reply=30#forum');
    });
});
