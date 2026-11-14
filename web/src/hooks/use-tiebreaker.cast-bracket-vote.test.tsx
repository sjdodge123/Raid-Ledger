/**
 * useCastBracketVote error handling: a refused bracket vote must surface a
 * toast and refetch the tiebreaker so the card stops showing the matchup open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';

const API_BASE = 'http://localhost:3000';

vi.mock('./use-auth', () => ({
    getAuthToken: () => 'test-token',
}));

const mockToastError = vi.fn();
vi.mock('../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

import { useCastBracketVote, TIEBREAKER_KEY } from './use-tiebreaker';

const REFUSAL = 'This tiebreaker has already been decided';

function createWrapper(): {
    wrapper: ({ children }: { children: ReactNode }) => ReactNode;
    queryClient: QueryClient;
} {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return { wrapper, queryClient };
}

describe('useCastBracketVote — refused vote', () => {
    beforeEach(() => {
        mockToastError.mockReset();
        server.use(
            http.post(`${API_BASE}/lineups/:id/tiebreaker/bracket-vote`, () =>
                HttpResponse.json({ statusCode: 400, message: REFUSAL }, { status: 400 }),
            ),
        );
    });

    it('shows the server message as an error toast and refetches the tiebreaker', async () => {
        const { wrapper, queryClient } = createWrapper();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useCastBracketVote(), { wrapper });

        act(() => {
            result.current.mutate({ lineupId: 7, matchupId: 3, gameId: 11 });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(mockToastError).toHaveBeenCalledWith(REFUSAL);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: [...TIEBREAKER_KEY] });
    });
});
