/**
 * ROK-2153 — the claim status query (keyed under the hub page, so a page
 * invalidation refetches it; 4xx never retried) and the claim mutation's
 * invalidations: my characters, every public profile, the hub page, and every hub membership only
 * when the claim made the viewer a member; then the provider's `onClaimed`.
 */
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import {
    buildHubClaimResult, buildHubClaimStatus, hubClaimErrorHandler, hubClaimPostHandler, hubClaimStatusHandler, type HubClaimCall,
} from '../../../test/mocks/hub-claim-handlers';
import { guildPageKey } from '../api/use-guild';
import { hubClaimKey, MY_CHARACTERS_KEY, useClaimHubCandidate, useHubClaim } from './use-hub-claim';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useViewerCacheScope: () => 1,
}));

function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    return { client, wrapper };
}

/** The query keys `invalidateQueries` was called with, as JSON for easy matching. */
function spyInvalidations(client: QueryClient): () => string[] {
    const spy = vi.spyOn(client, 'invalidateQueries');
    return () => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}

describe('useHubClaim', () => {
    it('fetches the status under the hub page key, viewer last', async () => {
        server.use(hubClaimStatusHandler(buildHubClaimStatus({ provider: 'valheim' })));
        const { client, wrapper } = setup();
        const { result } = renderHook(() => useHubClaim(7, true), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.provider).toBe('valheim');
        expect(client.getQueryCache().find({ queryKey: [...hubClaimKey(7), 1], exact: true })).toBeDefined();
        expect(hubClaimKey(7).slice(0, guildPageKey(7).length)).toEqual([...guildPageKey(7)]);
    });

    it('refetches when the hub page key is invalidated', async () => {
        const hits = { count: 0 };
        server.use(hubClaimStatusHandler(buildHubClaimStatus(), hits));
        const { client, wrapper } = setup();
        const { result } = renderHook(() => useHubClaim(7, true), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(hits.count).toBe(1);
        await act(() => client.invalidateQueries({ queryKey: guildPageKey(7) }));
        await waitFor(() => expect(hits.count).toBe(2));
    });

    it('does not fetch while disabled', () => {
        const hits = { count: 0 };
        server.use(hubClaimStatusHandler(buildHubClaimStatus(), hits));
        const { wrapper } = setup();
        const { result } = renderHook(() => useHubClaim(7, false), { wrapper });
        expect(result.current.fetchStatus).toBe('idle');
        expect(hits.count).toBe(0);
    });

    it('treats a 404 (no provider serves this hub) as an answer, never retried', async () => {
        const hits = { count: 0 };
        server.use(http.get('http://localhost:3000/guilds/:id/claim', () => {
            hits.count += 1;
            return HttpResponse.json({ statusCode: 404, code: 'HUB_CLAIM_UNAVAILABLE', message: 'gone' }, { status: 404 });
        }));
        const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const { result } = renderHook(() => useHubClaim(7, true), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(hits.count).toBe(1);
    });
});

describe('useClaimHubCandidate', () => {
    it('POSTs options, invalidates characters + public profiles + the hub page, not memberships, then calls onClaimed', async () => {
        const calls: HubClaimCall[] = [];
        const claimed = buildHubClaimResult({ becameMember: false });
        server.use(hubClaimPostHandler(claimed, calls));
        const { client, wrapper } = setup();
        const invalidated = spyInvalidations(client);
        const onClaimed = vi.fn();
        const { result } = renderHook(() => useClaimHubCandidate(7, onClaimed), { wrapper });
        await act(() => result.current.mutateAsync({ candidateId: '12:Generic:Human:1', options: { ruleset: 'hardcore' } }));
        expect(calls).toEqual([{ hubId: 7, candidateId: '12:Generic:Human:1', body: { options: { ruleset: 'hardcore' } } }]);
        expect(invalidated()).toEqual(expect.arrayContaining([JSON.stringify(MY_CHARACTERS_KEY), JSON.stringify(guildPageKey(7))]));
        // A public profile visited earlier lists the claimed character straight away.
        expect(invalidated()).toContain(JSON.stringify(['userProfile']));
        expect(invalidated()).not.toContain(JSON.stringify(['hubs-directory']));
        expect(onClaimed).toHaveBeenCalledWith(claimed, client);
    });

    it('sends an empty body without options, and refreshes every hub membership when becameMember', async () => {
        const calls: HubClaimCall[] = [];
        server.use(hubClaimPostHandler(buildHubClaimResult({ becameMember: true }), calls));
        const { client, wrapper } = setup();
        const invalidated = spyInvalidations(client);
        const { result } = renderHook(() => useClaimHubCandidate(7), { wrapper });
        await act(() => result.current.mutateAsync({ candidateId: 'c-1' }));
        expect(calls[0]?.body).toEqual({});
        expect(invalidated()).toEqual(expect.arrayContaining([
            JSON.stringify(MY_CHARACTERS_KEY), JSON.stringify(['plugins', 'wow', 'guilds']), JSON.stringify(['hubs-directory']), JSON.stringify(['game-hubs']),
        ]));
    });

    it('surfaces a 409 taken error and runs no invalidation or onClaimed', async () => {
        server.use(hubClaimErrorHandler('post', 'HUB_CLAIM_CANDIDATE_TAKEN'));
        const { client, wrapper } = setup();
        const invalidated = spyInvalidations(client);
        const onClaimed = vi.fn();
        const { result } = renderHook(() => useClaimHubCandidate(7, onClaimed), { wrapper });
        await act(async () => { await result.current.mutateAsync({ candidateId: 'c-1' }).catch(() => undefined); });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(invalidated()).toEqual([]);
        expect(onClaimed).not.toHaveBeenCalled();
    });
});
