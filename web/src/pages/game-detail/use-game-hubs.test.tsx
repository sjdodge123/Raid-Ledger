/**
 * ROK-1870 Codex r3 — the two-proposal limit is global, so submit and
 * withdraw must refresh EVERY game's hubs card, not just the current one.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test/render-helpers';
import { fetchApi } from '../../lib/api/fetch-api';
import { gameHubsKey, useProposeHub, useWithdrawProposal } from './use-game-hubs';

vi.mock('../../lib/api/fetch-api', () => ({ fetchApi: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Seed two games' cards; game 2 is the "other" card the limit also governs. */
function seedCards(): void {
    for (const id of [1, 2]) qc.setQueryData(gameHubsKey(id), { hubs: [], myProposals: [], canPropose: id === 1 });
}

const otherCardInvalidated = (): boolean | undefined => qc.getQueryState(gameHubsKey(2))?.isInvalidated;

beforeEach(() => {
    qc = createTestQueryClient();
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
        await act(() => result.current.mutateAsync({ gameId: 1, name: 'Crew' }));
        expect(otherCardInvalidated()).toBe(true);
    });
});
