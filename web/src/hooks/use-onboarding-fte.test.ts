import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { User } from './use-auth';

const mockFetchApi = vi.fn();

vi.mock('../lib/api-client', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

import { useCompleteOnboardingFte } from './use-onboarding-fte';

const COMPLETED_AT = '2026-09-29T12:00:00.000Z';

const staleUser: User = {
    id: 7, discordId: 'd-7', username: 'newbie', displayName: null, avatar: null,
    customAvatarUrl: null, role: 'member', steamId: null, onboardingCompletedAt: null,
};

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'me'], staleUser);
    // An active auth/me observer (AuthGuard's useAuth) whose refetch never
    // lands during the test — the slow network the bug needs.
    const refetchAuthMe = vi.fn(() => new Promise<User>(() => {}));
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => {
        useQuery({ queryKey: ['auth', 'me'], queryFn: refetchAuthMe, staleTime: Infinity });
        return useCompleteOnboardingFte();
    }, { wrapper });
    return { queryClient, result, refetchAuthMe };
}

describe('useCompleteOnboardingFte (TDB:982)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchApi.mockResolvedValue({ success: true, onboardingCompletedAt: COMPLETED_AT });
    });

    it('cache shows onboarding complete before the per-call onSuccess (where the wizard navigates) runs', async () => {
        const { queryClient, result, refetchAuthMe } = setup();
        let cachedAtNavigate: string | null | undefined = 'navigate-not-called';
        const navigate = vi.fn(() => {
            cachedAtNavigate = queryClient.getQueryData<User>(['auth', 'me'])?.onboardingCompletedAt;
        });

        act(() => { result.current.mutate(undefined, { onSuccess: navigate }); });

        await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
        expect(cachedAtNavigate).toBe(COMPLETED_AT);
        // Server reconciliation still fires (it just is not what navigation waits on).
        expect(refetchAuthMe).toHaveBeenCalled();
    });
});
