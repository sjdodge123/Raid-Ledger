/**
 * ROK-1316 AC7 — pending → poll → render for the SWR suggestions hook.
 *
 * A cold-cache read returns `pending: true` with empty suggestions; the
 * background pre-gen job warms the cache, and the hook must keep polling
 * until a real (non-pending) payload arrives, then stop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

// The combined plugin+toggle gate is exercised elsewhere; force it on so
// this test isolates the pending→poll behaviour.
vi.mock('./use-ai-suggestions-available', () => ({
    useAiSuggestionsAvailable: () => true,
}));

import { useAiSuggestions } from './use-ai-suggestions';

const PENDING_BODY: AiSuggestionsResponseDto = {
    suggestions: [],
    generatedAt: new Date().toISOString(),
    voterCount: 0,
    voterScopeStrategy: 'community',
    cached: false,
    pending: true,
};

const RESOLVED_BODY: AiSuggestionsResponseDto = {
    suggestions: [
        {
            gameId: 7,
            name: 'Warm Game',
            slug: 'warm-game',
            coverUrl: null,
            confidence: 0.9,
            reasoning: 'high overlap',
            ownershipCount: 3,
            voterTotal: 4,
            communityOwnerCount: 10,
            wishlistCount: 2,
            nonOwnerPrice: null,
            itadCurrentCut: null,
            itadCurrentShop: null,
            itadCurrentUrl: null,
            earlyAccess: false,
            itadTags: [],
            playerCount: null,
        },
    ],
    generatedAt: new Date().toISOString(),
    voterCount: 4,
    voterScopeStrategy: 'partial',
    cached: true,
};

function createWrapper(): {
    wrapper: ({ children }: { children: ReactNode }) => ReactNode;
} {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return { wrapper };
}

describe('useAiSuggestions — ROK-1316 pending → poll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps polling while pending, then renders the resolved payload', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                calls += 1;
                // First two reads are still warming; the third is resolved.
                return HttpResponse.json(calls < 3 ? PENDING_BODY : RESOLVED_BODY);
            }),
        );

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useAiSuggestions(99), { wrapper });

        // First success is the cold pending payload.
        await waitFor(() => {
            expect(result.current.data?.kind).toBe('ok');
            if (result.current.data?.kind === 'ok') {
                expect(result.current.data.data.pending).toBe(true);
            }
        });

        // refetchInterval polls until a non-pending payload arrives.
        await waitFor(
            () => {
                expect(result.current.data?.kind).toBe('ok');
                if (result.current.data?.kind === 'ok') {
                    expect(result.current.data.data.pending).toBeUndefined();
                    expect(result.current.data.data.suggestions).toHaveLength(1);
                }
            },
            { timeout: 15_000 },
        );

        expect(calls).toBeGreaterThanOrEqual(3);
    }, 20_000);

    it('does not poll when the first response is already resolved', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                calls += 1;
                return HttpResponse.json(RESOLVED_BODY);
            }),
        );

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useAiSuggestions(99), { wrapper });

        await waitFor(() => {
            expect(result.current.data?.kind).toBe('ok');
            if (result.current.data?.kind === 'ok') {
                expect(result.current.data.data.suggestions).toHaveLength(1);
            }
        });

        // Give a refetchInterval window a chance to fire — it must not.
        await new Promise((r) => setTimeout(r, 100));
        expect(calls).toBe(1);
    });
});
