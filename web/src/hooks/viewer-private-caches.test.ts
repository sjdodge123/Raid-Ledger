/**
 * ROK-1599 Codex P1 (r3): the Calendars overview carries the viewer's bearer
 * feed URL, so it must not survive ANY identity change — including the ones
 * no explicit logout/impersonate call sees (a token refresh that ends
 * impersonation, a re-mint after another tab signed in as someone else).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { dropViewerPrivateCaches, installViewerPrivateCacheGuard, tokenIdentity } from './viewer-private-caches';

const OVERVIEW = ['calendars', 'overview'];
const FEED = { feed: { url: 'https://raid.example.test/api/cal/u/viewer-a-feed.ics' } };

/** An unsigned JWT (readClaims never verifies). `n` keeps same-identity tokens distinct. */
function jwt(claims: Record<string, unknown>, n = 0): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 + n, ...claims })}.sig`;
}

describe('ROK-1599: viewer-private cache guard', () => {
    let queryClient: QueryClient;
    let uninstall: () => void;

    beforeEach(() => {
        clearAccessToken();
        queryClient = new QueryClient();
        setAccessToken(jwt({ sub: 1 }));
        uninstall = installViewerPrivateCacheGuard(queryClient);
        queryClient.setQueryData(OVERVIEW, FEED);
    });
    afterEach(() => {
        uninstall();
        clearAccessToken();
    });

    it('a token for a different subject drops the previous viewer\'s overview', () => {
        setAccessToken(jwt({ sub: 2 }));
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });

    it('a refresh that ends impersonation (impersonatedBy goes away) drops it', () => {
        setAccessToken(jwt({ sub: 9, impersonatedBy: 1 }));
        queryClient.setQueryData(OVERVIEW, FEED);
        setAccessToken(jwt({ sub: 1 }, 1));
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });

    it('a cleared token followed by a different subject still drops it (compares with the last held identity)', () => {
        clearAccessToken();
        expect(queryClient.getQueryData(OVERVIEW)).toEqual(FEED);
        setAccessToken(jwt({ sub: 2 }));
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });

    it('a same-identity refresh keeps the cache (no needless refetch)', () => {
        setAccessToken(jwt({ sub: 1 }, 7));
        clearAccessToken();
        setAccessToken(jwt({ sub: 1 }, 8));
        expect(queryClient.getQueryData(OVERVIEW)).toEqual(FEED);
    });

    it('ROK-1811: an identity change clears every key (not an allow-list) and keeps the auth seed', () => {
        const others = [['notifications', 20, 0], ['notifications', 'unread-count'], ['me', 'characters', 1]];
        for (const key of others) queryClient.setQueryData(key, { ownedBy: 1 });
        queryClient.setQueryData(['auth', 'me'], { id: 1 });
        setAccessToken(jwt({ sub: 2 }));
        expect(others.map((key) => queryClient.getQueryData(key))).toEqual(others.map(() => undefined));
        expect(queryClient.getQueryData(['auth', 'me'])).toEqual({ id: 1 });
        expect(queryClient.getQueryState(['auth', 'me'])?.isInvalidated).toBe(true);
    });

    it('ROK-1811: a drop keeps the SAME auth Query (its observers) and its timestamp', () => {
        queryClient.setQueryData(['auth', 'me'], { id: 1 }, { updatedAt: 1000 });
        const before = queryClient.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true });
        dropViewerPrivateCaches(queryClient);
        const after = queryClient.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true });
        expect(after).toBe(before);
        expect(queryClient.getQueryState(['auth', 'me'])?.dataUpdatedAt).toBe(1000);
        expect(queryClient.getQueryData(OVERVIEW)).toBeUndefined();
    });

    it('ROK-1811: a same-identity refresh keeps every cache', () => {
        queryClient.setQueryData(['notifications', 'unread-count'], 3);
        setAccessToken(jwt({ sub: 1 }, 9));
        expect(queryClient.getQueryData(['notifications', 'unread-count'])).toBe(3);
        expect(queryClient.getQueryData(OVERVIEW)).toEqual(FEED);
    });

    it('ROK-1811: a drop with no auth seed leaves none (never invents a signed-out null)', () => {
        dropViewerPrivateCaches(queryClient);
        expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it('tokenIdentity reads subject + impersonator, null for none or garbage', () => {
        expect(tokenIdentity(jwt({ sub: 9, impersonatedBy: 1 }))).toBe('9:1');
        expect(tokenIdentity(null)).toBeNull();
        expect(tokenIdentity('not-a-jwt')).toBeNull();
    });
});
