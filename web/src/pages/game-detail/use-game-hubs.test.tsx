/**
 * ROK-1870 Codex r3 — the two-proposal limit is global, so submit and
 * withdraw must refresh EVERY game's hubs card, not just the current one.
 * ROK-1883 — the card's key ends in the viewer scope, and the membership
 * invalidation's `['game-hubs']` prefix still reaches it.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test/render-helpers';
import { fetchApi } from '../../lib/api/fetch-api';
import { invalidateHubMembership } from '../../components/hub/community/invalidate-hub-membership';
import { gameHubsKey, useGameHubs, useProposeHub, useWithdrawProposal } from './use-game-hubs';

const viewer = vi.hoisted(() => ({ current: 7 as number | 'anon' }));

vi.mock('../../lib/api/fetch-api', () => ({ fetchApi: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useViewerCacheScope: () => viewer.current,
}));

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Seed two games' cards; game 2 is the "other" card the limit also governs. */
function seedCards(): void {
    for (const id of [1, 2]) qc.setQueryData(gameHubsKey(id, 7), { hubs: [], myProposals: [], canPropose: id === 1 });
}

const otherCardInvalidated = (): boolean | undefined => qc.getQueryState(gameHubsKey(2, 7))?.isInvalidated;

beforeEach(() => {
    qc = createTestQueryClient();
    viewer.current = 7;
    seedCards();
    vi.mocked(fetchApi).mockReset();
});

describe('proposal mutations refresh every game card', () => {
    it('withdraw invalidates another game\'s card (its Start button may re-enable)', async () => {
        vi.mocked(fetchApi).mockResolvedValue(undefined);
        const { result } = renderHook(() => useWithdrawProposal(), { wrapper });
        await act(() => result.current.mutateAsync(11));
        expect(otherCardInvalidated()).toBe(true);
    });

    it('submit invalidates another game\'s card (the limit may now be reached)', async () => {
        vi.mocked(fetchApi).mockResolvedValue({ id: 12 });
        const { result } = renderHook(() => useProposeHub(1), { wrapper });
        await act(() => result.current.mutateAsync({ gameId: 1, name: 'Crew', blurb: 'A crew' }));
        expect(otherCardInvalidated()).toBe(true);
    });
});

describe('viewer-scoped key (ROK-1883 AC14)', () => {
    it('the key is [game-hubs, gameId, viewer]', () => {
        expect(gameHubsKey(5, 7)).toEqual(['game-hubs', 5, 7]);
        expect(gameHubsKey(5, 'anon')).toEqual(['game-hubs', 5, 'anon']);
    });

    it('the read caches under the current viewer only — another viewer never sees it', async () => {
        const payload = { hubs: [], myProposals: [], canPropose: true, proposeBlockedReason: null };
        vi.mocked(fetchApi).mockResolvedValue(payload);
        const { result } = renderHook(() => useGameHubs(5), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(qc.getQueryData(gameHubsKey(5, 7))).toEqual(payload);
        expect(qc.getQueryData(gameHubsKey(5, 8))).toBeUndefined();
        expect(vi.mocked(fetchApi).mock.calls[0]?.[0]).toBe('/hubs/by-game/5');
    });

    it('invalidateHubMembership\'s [game-hubs] prefix still reaches a viewer-scoped card', async () => {
        await invalidateHubMembership(qc, 99);
        expect(qc.getQueryState(gameHubsKey(1, 7))?.isInvalidated).toBe(true);
        expect(otherCardInvalidated()).toBe(true);
    });
});
