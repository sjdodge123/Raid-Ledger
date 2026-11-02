import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCancelSignup } from './use-signups';

const api = vi.hoisted(() => ({ cancelSignup: vi.fn(), signupForEvent: vi.fn(), confirmSignup: vi.fn(), updateSignupStatus: vi.fn() }));
vi.mock('../lib/api-client', () => api);

describe('use-signups series invalidation (ROK-1728)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('a one-night cancel (Skip this night) invalidates every night\'s series state, not just this one', async () => {
        api.cancelSignup.mockResolvedValue(undefined);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useCancelSignup(10), { wrapper });
        result.current.mutate();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
        expect(keys).toContain(JSON.stringify(['series-signup']));
    });
});
