/**
 * Tests for use-lineups hooks (ROK-934, ROK-1065).
 * Validates useActiveLineups (array), useCommonGround, and useNominateGame.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- API client mocks ---
const mockGetActiveLineups = vi.fn();
const mockGetCommonGround = vi.fn();
const mockNominateGame = vi.fn();
const mockGetLineupBanner = vi.fn();
const mockGetLineupById = vi.fn();
const mockRemoveNomination = vi.fn();
const mockToggleVote = vi.fn();
const mockAddLineupInvitees = vi.fn();
const mockRemoveLineupInvitee = vi.fn();

vi.mock('../lib/api-client', () => ({
    getActiveLineups: (...args: unknown[]) => mockGetActiveLineups(...args),
    getCommonGround: (...args: unknown[]) => mockGetCommonGround(...args),
    nominateGame: (...args: unknown[]) => mockNominateGame(...args),
    getLineupBanner: (...args: unknown[]) => mockGetLineupBanner(...args),
    getLineupById: (...args: unknown[]) => mockGetLineupById(...args),
    removeNomination: (...args: unknown[]) => mockRemoveNomination(...args),
    toggleVote: (...args: unknown[]) => mockToggleVote(...args),
    addLineupInvitees: (...args: unknown[]) => mockAddLineupInvitees(...args),
    removeLineupInvitee: (...args: unknown[]) =>
        mockRemoveLineupInvitee(...args),
}));

import {
    useActiveLineups, useCommonGround, useNominateGame,
    useLineupBanner, useLineupDetail, useRemoveNomination,
    useToggleVote,
    useAddLineupInvitees, useRemoveLineupInvitee,
} from './use-lineups';

// --- Helpers ---

const ACTIVE_LINEUP_KEY = ['lineups', 'active'];
const COMMON_GROUND_KEY = ['common-ground'];

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return { queryClient, wrapper };
}

const mockLineupResponse = {
    id: 1,
    title: 'Test Lineup',
    description: null,
    status: 'building' as const,
    targetDate: null,
    decidedGameId: null,
    decidedGameName: null,
    linkedEventId: null,
    createdBy: { id: 1, displayName: 'Admin' },
    votingDeadline: null,
    entries: [],
    totalVoters: 0,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    // ROK-1065
    visibility: 'public' as const,
    invitees: [],
};

const mockCommonGroundResponse = {
    data: [
        {
            gameId: 42,
            gameName: 'Valheim',
            slug: 'valheim',
            coverUrl: null,
            ownerCount: 5,
            wishlistCount: 2,
            nonOwnerPrice: 19.99,
            itadCurrentCut: 25,
            itadCurrentShop: 'Steam',
            itadCurrentUrl: null,
            earlyAccess: false,
            itadTags: [],
            playerCount: null,
            score: 80,
        },
    ],
    meta: {
        total: 1,
        appliedWeights: { ownerWeight: 1, saleBonus: 0.5, fullPricePenalty: 0.2 },
        activeLineupId: 1,
        nominatedCount: 0,
        maxNominations: 10,
    },
};

// --- Tests ---

describe('useActiveLineups (ROK-1065)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSummaryRow = {
        id: 1,
        title: 'Weekend Raid',
        status: 'building' as const,
        targetDate: null,
        entryCount: 0,
        totalVoters: 0,
        createdAt: '2026-03-01T00:00:00Z',
        visibility: 'public' as const,
    };

    it('returns lineup array on success', async () => {
        const { wrapper } = createWrapper();
        mockGetActiveLineups.mockResolvedValue([mockSummaryRow]);

        const { result } = renderHook(() => useActiveLineups(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([mockSummaryRow]);
        expect(mockGetActiveLineups).toHaveBeenCalledTimes(1);
    });

    it('returns error state when API call fails', async () => {
        const { wrapper } = createWrapper();
        mockGetActiveLineups.mockRejectedValue(new Error('Boom'));

        const { result } = renderHook(() => useActiveLineups(), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(Error);
    });
});

describe('useAddLineupInvitees / useRemoveLineupInvitee (ROK-1065)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('add invitees calls API with lineupId + userIds', async () => {
        mockAddLineupInvitees.mockResolvedValue(mockLineupResponse);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useAddLineupInvitees(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, userIds: [5, 7] });
        });
        expect(mockAddLineupInvitees).toHaveBeenCalledWith(1, [5, 7]);
    });

    it('remove invitee calls API with lineupId + userId', async () => {
        mockRemoveLineupInvitee.mockResolvedValue(mockLineupResponse);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useRemoveLineupInvitee(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, userId: 5 });
        });
        expect(mockRemoveLineupInvitee).toHaveBeenCalledWith(1, 5);
    });
});

describe('useCommonGround', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns common ground data on success', async () => {
        const { wrapper } = createWrapper();
        mockGetCommonGround.mockResolvedValue(mockCommonGroundResponse);

        const params = { minOwners: 3 };
        const { result } = renderHook(
            () => useCommonGround(params),
            { wrapper },
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockCommonGroundResponse);
        expect(mockGetCommonGround).toHaveBeenCalledWith(params);
    });

    it('includes params in the query key', async () => {
        const { wrapper, queryClient } = createWrapper();
        mockGetCommonGround.mockResolvedValue(mockCommonGroundResponse);

        const params = { minOwners: 5, genre: 'RPG' };
        const { result } = renderHook(
            () => useCommonGround(params),
            { wrapper },
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // The cache entry should be keyed with the params
        const cached = queryClient.getQueryData([...COMMON_GROUND_KEY, params]);
        expect(cached).toEqual(mockCommonGroundResponse);
    });

    it('does not fetch when enabled is false', async () => {
        const { wrapper } = createWrapper();

        const { result } = renderHook(
            () => useCommonGround({ minOwners: 2 }, false),
            { wrapper },
        );

        // Wait a tick to ensure no async query fires
        await new Promise((r) => setTimeout(r, 50));
        expect(result.current.fetchStatus).toBe('idle');
        expect(mockGetCommonGround).not.toHaveBeenCalled();
    });

    it('fetches with different params producing separate cache entries', async () => {
        const { wrapper, queryClient } = createWrapper();
        const response1 = { ...mockCommonGroundResponse, meta: { ...mockCommonGroundResponse.meta, total: 5 } };
        const response2 = { ...mockCommonGroundResponse, meta: { ...mockCommonGroundResponse.meta, total: 3 } };

        mockGetCommonGround.mockResolvedValueOnce(response1);
        mockGetCommonGround.mockResolvedValueOnce(response2);

        const params1 = { minOwners: 2 };
        const params2 = { minOwners: 4 };

        const { result: r1 } = renderHook(
            () => useCommonGround(params1),
            { wrapper },
        );
        await waitFor(() => expect(r1.current.isSuccess).toBe(true));

        const { result: r2 } = renderHook(
            () => useCommonGround(params2),
            { wrapper },
        );
        await waitFor(() => expect(r2.current.isSuccess).toBe(true));

        // Both cache entries should exist independently
        expect(queryClient.getQueryData([...COMMON_GROUND_KEY, params1])).toEqual(response1);
        expect(queryClient.getQueryData([...COMMON_GROUND_KEY, params2])).toEqual(response2);
    });
});

describe('useNominateGame', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls nominateGame with lineupId and body', async () => {
        const { wrapper } = createWrapper();
        mockNominateGame.mockResolvedValue(mockLineupResponse);

        const { result } = renderHook(() => useNominateGame(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({
                lineupId: 1,
                body: { gameId: 42 },
            });
        });

        expect(mockNominateGame).toHaveBeenCalledWith(1, { gameId: 42 });
    });

    it('invalidates lineup and common-ground queries on success', async () => {
        const { wrapper, queryClient } = createWrapper();
        mockNominateGame.mockResolvedValue(mockLineupResponse);

        // Seed query caches so invalidation can be observed
        queryClient.setQueryData([...ACTIVE_LINEUP_KEY], mockLineupResponse);
        queryClient.setQueryData([...COMMON_GROUND_KEY, { minOwners: 2 }], mockCommonGroundResponse);

        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useNominateGame(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({
                lineupId: 1,
                body: { gameId: 42 },
            });
        });

        // Should invalidate all lineup queries via prefix
        const lineupCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(['lineups']),
        );
        expect(lineupCalls.length).toBeGreaterThanOrEqual(1);

        // Should invalidate the common-ground key prefix
        const commonGroundCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(COMMON_GROUND_KEY),
        );
        expect(commonGroundCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('does not invalidate queries on mutation error', async () => {
        const { wrapper, queryClient } = createWrapper();
        mockNominateGame.mockRejectedValue(new Error('Conflict'));

        queryClient.setQueryData([...ACTIVE_LINEUP_KEY], mockLineupResponse);
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useNominateGame(), { wrapper });

        await act(async () => {
            try {
                await result.current.mutateAsync({
                    lineupId: 1,
                    body: { gameId: 99 },
                });
            } catch {
                // Expected — mutation should fail
            }
        });

        expect(invalidateSpy).not.toHaveBeenCalled();
    });
});

const mockBanner = {
    id: 1,
    status: 'building' as const,
    targetDate: '2026-03-28',
    entryCount: 5,
    totalVoters: 3,
    totalMembers: 10,
    decidedGameName: null,
    entries: [{ gameId: 42, gameName: 'Valheim', gameCoverUrl: null, ownerCount: 5, voteCount: 2 }],
};

describe('useLineupBanner', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('fetches banner data on mount', async () => {
        mockGetLineupBanner.mockResolvedValue(mockBanner);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useLineupBanner(), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockBanner);
        expect(mockGetLineupBanner).toHaveBeenCalledTimes(1);
    });

    it('handles null response', async () => {
        mockGetLineupBanner.mockResolvedValue(null);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useLineupBanner(), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
    });
});

describe('useLineupDetail', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('fetches detail when id is provided', async () => {
        mockGetLineupById.mockResolvedValue(mockLineupResponse);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useLineupDetail(1), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockLineupResponse);
        expect(mockGetLineupById).toHaveBeenCalledWith(1);
    });

    it('does not fetch when id is undefined', () => {
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useLineupDetail(undefined), { wrapper });
        expect(result.current.isFetching).toBe(false);
        expect(mockGetLineupById).not.toHaveBeenCalled();
    });
});

describe('useRemoveNomination', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('calls removeNomination with lineupId and gameId', async () => {
        mockRemoveNomination.mockResolvedValue(undefined);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useRemoveNomination(), { wrapper });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, gameId: 42 });
        });
        expect(mockRemoveNomination).toHaveBeenCalledWith(1, 42);
    });

    it('invalidates lineup queries on success', async () => {
        mockRemoveNomination.mockResolvedValue(undefined);
        const { wrapper, queryClient } = createWrapper();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useRemoveNomination(), { wrapper });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, gameId: 42 });
        });
        expect(invalidateSpy).toHaveBeenCalled();
    });
});

describe('useToggleVote', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('calls toggleVote with lineupId and gameId', async () => {
        mockToggleVote.mockResolvedValue(mockLineupResponse);
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useToggleVote(), { wrapper });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, gameId: 42 });
        });
        expect(mockToggleVote).toHaveBeenCalledWith(1, 42);
    });

    it('invalidates lineup queries on success', async () => {
        mockToggleVote.mockResolvedValue(mockLineupResponse);
        const { wrapper, queryClient } = createWrapper();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useToggleVote(), { wrapper });
        await act(async () => {
            await result.current.mutateAsync({ lineupId: 1, gameId: 42 });
        });
        const lineupCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify(['lineups']),
        );
        expect(lineupCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects on failure', async () => {
        mockToggleVote.mockRejectedValue(new Error('Vote limit'));
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useToggleVote(), { wrapper });
        await expect(
            act(() => result.current.mutateAsync({ lineupId: 1, gameId: 99 })),
        ).rejects.toThrow('Vote limit');
    });
});
