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

/** Stands in for `getPublicLineup`: never sends a token, so it answers the same for everyone. */
const fetchPublicLineup = vi.fn(async (): Promise<string> => 'public lineup abc');

function PublicLineup() {
    const { data, isPending } = useQuery({ queryKey: ['lineups', 'public', 'abc'], queryFn: fetchPublicLineup, retry: false });
    return <p>{isPending ? 'lineup pending' : data}</p>;
}

describe('ROK-1811 Codex r3 P2: a mounted public lineup across a cross-tab logout', () => {
    let queryClient: QueryClient;

    beforeEach(async () => {
        fetchPrefs.mockClear();
        fetchPublicLineup.mockClear();
        setAccessToken(jwt({ sub: 9 }));
        queryClient = new QueryClient();
        render(<QueryClientProvider client={queryClient}><PublicLineup /><Prefs /></QueryClientProvider>);
        expect(await screen.findByText('public lineup abc')).toBeTruthy();
        expect(await screen.findByText('preferences for 9')).toBeTruthy();
    });
    afterEach(() => { clearAccessToken(); });

    it('keeps the public lineup on screen while the private query empties without firing', async () => {
        act(() => {
            clearAccessToken();
            dropViewerPrivateCaches(queryClient);
        });
        await waitFor(() => { expect(screen.queryByText('preferences for 9')).toBeNull(); });
        expect(screen.getByText('no preferences')).toBeTruthy();
        expect(screen.queryByText('lineup pending')).toBeNull();
        expect(screen.getByText('public lineup abc')).toBeTruthy();
        expect(queryClient.getQueryData(['lineups', 'public', 'abc'])).toBe('public lineup abc');
        await waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
        expect(fetchPrefs).toHaveBeenCalledTimes(1);
    });
});

/** Stands in for `useCalendarsOverview`: reads the token at render without subscribing to it. */
const fetchCalendars = vi.fn(async (): Promise<string> => {
    const token = getAccessToken();
    if (token === null) throw new Error('unauthenticated request');
    return `calendars for ${String(readClaims(token)?.sub)}`;
});

function Calendars() {
    const { data } = useQuery({
        queryKey: ['calendars', 'overview'],
        queryFn: fetchCalendars,
        enabled: getAccessToken() !== null,
        staleTime: Infinity,
        retry: false,
    });
    return <p>{data ?? 'no calendars'}</p>;
}

describe('ROK-1811 Codex r4 P2a: a mounted token-gated query across a cross-tab re-mint', () => {
    let queryClient: QueryClient;
    let uninstall: () => void;

    beforeEach(async () => {
        fetchCalendars.mockClear();
        setAccessToken(jwt({ sub: 9 }));
        queryClient = new QueryClient();
        uninstall = installViewerPrivateCacheGuard(queryClient);
        render(<QueryClientProvider client={queryClient}><Calendars /></QueryClientProvider>);
        expect(await screen.findByText('calendars for 9')).toBeTruthy();
        // followIdentityChange: clear the token and drop BEFORE awaiting the refresh.
        act(() => {
            clearAccessToken();
            dropViewerPrivateCaches(queryClient);
        });
        expect(await screen.findByText('no calendars')).toBeTruthy();
        // Precondition: the hook re-rendered with no token, so its observer is now disabled.
        expect(queryClient.getQueryCache().find({ queryKey: ['calendars', 'overview'] })?.isActive()).toBe(false);
    });
    afterEach(() => {
        uninstall();
        clearAccessToken();
    });

    it.each([9, 2])('a re-mint as sub %i fetches it again although it re-rendered disabled', async (sub) => {
        act(() => { setAccessToken(jwt({ sub })); });
        await waitFor(() => { expect(fetchCalendars).toHaveBeenCalledTimes(2); });
        expect(await screen.findByText(`calendars for ${String(sub)}`)).toBeTruthy();
        await waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
        expect(fetchCalendars).toHaveBeenCalledTimes(2);
    });
});

/** Stands in for `getSystemStatus` (PrivacyPage's community name/contact): token-less, viewer-free. */
const fetchSystemStatus = vi.fn(async (): Promise<string> => 'community Raiders, contact privacy@example.test');

function PrivacyStatus() {
    const { data, isPending } = useQuery({ queryKey: ['system', 'status'], queryFn: fetchSystemStatus, retry: false });
    return <p>{isPending ? 'status pending' : data}</p>;
}

describe('ROK-1811 Codex r4 P2b: a mounted system status across a cross-tab logout', () => {
    let queryClient: QueryClient;

    beforeEach(async () => {
        fetchPrefs.mockClear();
        fetchSystemStatus.mockClear();
        setAccessToken(jwt({ sub: 9 }));
        queryClient = new QueryClient();
        render(<QueryClientProvider client={queryClient}><PrivacyStatus /><Prefs /></QueryClientProvider>);
        expect(await screen.findByText('community Raiders, contact privacy@example.test')).toBeTruthy();
        expect(await screen.findByText('preferences for 9')).toBeTruthy();
    });
    afterEach(() => { clearAccessToken(); });

    it('keeps the community data on screen while the private query empties without firing', async () => {
        act(() => {
            clearAccessToken();
            dropViewerPrivateCaches(queryClient);
        });
        await waitFor(() => { expect(screen.queryByText('preferences for 9')).toBeNull(); });
        expect(screen.queryByText('status pending')).toBeNull();
        expect(screen.getByText('community Raiders, contact privacy@example.test')).toBeTruthy();
        expect(queryClient.getQueryData(['system', 'status'])).toBe('community Raiders, contact privacy@example.test');
        await waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
        expect(fetchPrefs).toHaveBeenCalledTimes(1);
        expect(fetchSystemStatus).toHaveBeenCalledTimes(1);
    });
});
