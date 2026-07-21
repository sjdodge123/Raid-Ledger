import { describe, it, expect } from 'vitest';

import { isTokenStale } from './token-expiry';

/** Encode an object as a base64url JWT segment (no padding). */
function base64url(obj: Record<string, unknown>): string {
    return btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** Build a syntactically valid JWT (`header.payload.sig`) with the given exp. */
function makeToken(expSeconds: number | undefined): string {
    const payload: Record<string, unknown> = { sub: 'user-1' };
    if (expSeconds !== undefined) payload.exp = expSeconds;
    return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.sig`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('isTokenStale (ROK-1409)', () => {
    it('treats a comfortably-future token as fresh', () => {
        expect(isTokenStale(makeToken(nowSeconds() + 3600))).toBe(false);
    });

    it('treats an already-expired token as stale', () => {
        expect(isTokenStale(makeToken(nowSeconds() - 60))).toBe(true);
    });

    it('treats a token within the default 30s skew as stale', () => {
        expect(isTokenStale(makeToken(nowSeconds() + 10))).toBe(true);
    });

    it('honours a custom skew window', () => {
        const token = makeToken(nowSeconds() + 45);
        expect(isTokenStale(token, 30)).toBe(false);
        expect(isTokenStale(token, 60)).toBe(true);
    });

    it('treats a null/empty token as stale (nothing usable to send)', () => {
        expect(isTokenStale(null)).toBe(true);
        expect(isTokenStale(undefined)).toBe(true);
        expect(isTokenStale('')).toBe(true);
    });

    it('treats a malformed / undecodable token as NOT stale (reactive 401 handles it)', () => {
        expect(isTokenStale('not-a-jwt')).toBe(false);
        expect(isTokenStale('only.two')).toBe(false);
        expect(isTokenStale('a.b.c')).toBe(false);
        expect(isTokenStale(`${'x'.repeat(3)}.@@notbase64@@.sig`)).toBe(false);
    });

    it('treats a decodable token with no exp claim as NOT stale', () => {
        expect(isTokenStale(makeToken(undefined))).toBe(false);
    });
});
