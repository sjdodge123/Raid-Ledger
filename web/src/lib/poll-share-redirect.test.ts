/**
 * ROK-1750 (D5) — the pending share token survives sign-in in sessionStorage
 * and is handed back exactly once as the `/p/poll/<token>` path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    POLL_SHARE_TOKEN_KEY,
    savePendingPollShare,
    consumePendingPollShare,
    pollSharePath,
    pollShareUrl,
} from './poll-share-redirect';

describe('poll-share-redirect (ROK-1750 D5)', () => {
    beforeEach(() => sessionStorage.clear());

    it('save parks the token under poll_share_token', () => {
        savePendingPollShare('tok_abc');
        expect(sessionStorage.getItem(POLL_SHARE_TOKEN_KEY)).toBe('tok_abc');
        expect(POLL_SHARE_TOKEN_KEY).toBe('poll_share_token');
    });

    it('consume returns the share path once, then null (the key is cleared)', () => {
        savePendingPollShare('tok_abc');
        expect(consumePendingPollShare()).toBe('/p/poll/tok_abc');
        expect(sessionStorage.getItem(POLL_SHARE_TOKEN_KEY), 'consume must clear the key').toBeNull();
        expect(consumePendingPollShare(), 'a second consume must find nothing').toBeNull();
    });

    it('consume returns null when nothing is pending', () => {
        expect(consumePendingPollShare()).toBeNull();
    });

    it('builds the path and absolute URL with the token URI-encoded', () => {
        expect(pollSharePath('a b/c')).toBe('/p/poll/a%20b%2Fc');
        expect(pollShareUrl('tok_abc')).toBe(`${window.location.origin}/p/poll/tok_abc`);
    });
});
