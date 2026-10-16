/**
 * ROK-1599 Codex P1 (r3): the Calendars overview carries the viewer's bearer
 * feed URL, so it must not survive ANY identity change — including the ones
 * no explicit logout/impersonate call sees (a token refresh that ends
 * impersonation, a re-mint after another tab signed in as someone else).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { installViewerPrivateCacheGuard, tokenIdentity } from './viewer-private-caches';

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

    it('tokenIdentity reads subject + impersonator, null for none or garbage', () => {
        expect(tokenIdentity(jwt({ sub: 9, impersonatedBy: 1 }))).toBe('9:1');
        expect(tokenIdentity(null)).toBeNull();
        expect(tokenIdentity('not-a-jwt')).toBeNull();
    });
});
