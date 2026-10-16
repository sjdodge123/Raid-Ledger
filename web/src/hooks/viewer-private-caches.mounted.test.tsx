/**
 * ROK-1811 Codex r2 P1: a component that stays mounted across an identity
 * change (a memoized Outlet when impersonation ends) must not keep rendering
 * the previous viewer's private data. The drop resets its observed query and
 * refetches it as the new identity — or, with no token (logout), leaves it
 * empty without firing an unauthenticated request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { clearAccessToken, getAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { readClaims } from '../lib/api/token-expiry';
import { dropViewerPrivateCaches, installViewerPrivateCacheGuard } from './viewer-private-caches';

function jwt(claims: Record<string, unknown>): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800, ...claims })}.sig`;
}

/** Stands in for a private endpoint: answers for whoever holds the token. */
const fetchPrefs = vi.fn(async (): Promise<string> => {
    const token = getAccessToken();
    if (token === null) throw new Error('unauthenticated request');
    return `preferences for ${String(readClaims(token)?.sub)}`;
});

function Prefs() {
    const { data } = useQuery({ queryKey: ['notification-preferences'], queryFn: fetchPrefs, retry: false });
    return <p>{data ?? 'no preferences'}</p>;
}

describe('ROK-1811: a mounted private query across an identity change', () => {
    let queryClient: QueryClient;

    beforeEach(async () => {
        fetchPrefs.mockClear();
        setAccessToken(jwt({ sub: 9, impersonatedBy: 1 }));
        queryClient = new QueryClient();
        render(<QueryClientProvider client={queryClient}><Prefs /></QueryClientProvider>);
        expect(await screen.findByText('preferences for 9')).toBeTruthy();
    });
    afterEach(() => { clearAccessToken(); });

    it('impersonation ending under the guard refetches as the new identity, never showing the old', async () => {
        const uninstall = installViewerPrivateCacheGuard(queryClient);
        act(() => { setAccessToken(jwt({ sub: 1 })); });
        // Observers are notified on the notifyManager's next tick, not inside act().
        await waitFor(() => { expect(screen.queryByText('preferences for 9')).toBeNull(); });
        expect(await screen.findByText('preferences for 1')).toBeTruthy();
        expect(fetchPrefs).toHaveBeenCalledTimes(2);
        uninstall();
    });

    it('a logout drop empties it and fires no unauthenticated request', async () => {
        act(() => {
            clearAccessToken();
            dropViewerPrivateCaches(queryClient);
        });
        await waitFor(() => { expect(screen.queryByText('preferences for 9')).toBeNull(); });
        expect(screen.getByText('no preferences')).toBeTruthy();
        await waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
        expect(fetchPrefs).toHaveBeenCalledTimes(1);
    });
});
