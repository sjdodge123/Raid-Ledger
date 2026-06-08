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

// Stale SWR payload: older voter-hash row served while a refresh runs. Has
// content (one suggestion) so it renders without the cold skeleton.
const STALE_BODY: AiSuggestionsResponseDto = {
    ...RESOLVED_BODY,
    stale: true,
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

    // Rework #3: a permanently-stuck pre-gen (always pending) must not spin
    // forever — once polling exhausts its cap the hook reports `pollExhausted`
    // so consumers fall back to the empty state. Uses fake timers to advance
    // through the 15-attempt × 3s poll budget deterministically (and fast).
    it('reports pollExhausted=true when polling caps out still pending', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                calls += 1;
                // Never resolves — the pre-gen job is permanently stuck.
                return HttpResponse.json(PENDING_BODY);
            }),
        );

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useAiSuggestions(99), { wrapper });

        // First pending payload lands; not yet exhausted.
        await waitFor(() => {
            expect(result.current.data?.kind).toBe('ok');
            if (result.current.data?.kind === 'ok') {
                expect(result.current.data.data.pending).toBe(true);
            }
        });
        expect(result.current.pollExhausted).toBe(false);

        // Poll until the cap (15 × 3s ≈ 45s) is hit; polling then stops and
        // pollExhausted flips true so consumers fall back to empty state.
        await waitFor(() => expect(result.current.pollExhausted).toBe(true), {
            timeout: 55_000,
            interval: 250,
        });
        // Polling stopped at the cap — no runaway requests.
        const callsAtCap = calls;
        await new Promise((r) => setTimeout(r, 200));
        expect(calls).toBe(callsAtCap);
        // Still pending (never resolved) but consumers see not-loading.
        if (result.current.data?.kind === 'ok') {
            expect(result.current.data.data.pending).toBe(true);
        }
    }, 70_000);

    // Rework r2 #2: a `stale` payload must keep polling (revalidate) until the
    // background refresh lands, WITHOUT showing the cold skeleton.
    it('polls a stale payload and renders the fresh result when refresh lands', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                calls += 1;
                // First two reads are stale (refresh in flight); third is fresh.
                return HttpResponse.json(calls < 3 ? STALE_BODY : RESOLVED_BODY);
            }),
        );

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useAiSuggestions(99), { wrapper });

        // First payload is stale — content renders, NOT a cold skeleton.
        await waitFor(() => {
            expect(result.current.data?.kind).toBe('ok');
            if (result.current.data?.kind === 'ok') {
                expect(result.current.data.data.stale).toBe(true);
                expect(result.current.data.data.suggestions).toHaveLength(1);
            }
        });
        // Stale must NOT exhaust the cold skeleton path (it has content).
        expect(result.current.pollExhausted).toBe(false);

        // Polling revalidates until the fresh (non-stale) payload arrives.
        await waitFor(
            () => {
                expect(result.current.data?.kind).toBe('ok');
                if (result.current.data?.kind === 'ok') {
                    expect(result.current.data.data.stale).toBeUndefined();
                    expect(result.current.data.data.suggestions).toHaveLength(1);
                }
            },
            { timeout: 15_000 },
        );
        expect(calls).toBeGreaterThanOrEqual(3);
    }, 20_000);

    it('does not poll a fresh (non-stale) payload', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => {
                calls += 1;
                return HttpResponse.json(RESOLVED_BODY);
            }),
        );

        const { wrapper } = createWrapper();
        renderHook(() => useAiSuggestions(99), { wrapper });

        await waitFor(() => expect(calls).toBe(1));
        // No stale/pending → refetchInterval stays off.
        await new Promise((r) => setTimeout(r, 100));
        expect(calls).toBe(1);
    });

    // Rework r3 #2: poll budget must reset when the lineupId switches in-place
    // (no remount) — a new cold lineup must not inherit the prior lineup's
    // exhausted state and collapse its skeleton early.
    it('resets the poll budget when lineupId changes after exhaustion', async () => {
        server.use(
            // Every lineup stays pending — so exhaustion is reachable and the
            // post-switch lineup is also cold (would inherit pollExhausted).
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(PENDING_BODY),
            ),
        );

        const { wrapper } = createWrapper();
        const { result, rerender } = renderHook(
            ({ id }: { id: number }) => useAiSuggestions(id),
            { wrapper, initialProps: { id: 99 } },
        );

        // Exhaust the first lineup's poll budget.
        await waitFor(() => expect(result.current.pollExhausted).toBe(true), {
            timeout: 55_000,
            interval: 250,
        });

        // Switch lineup in-place — budget must reset immediately.
        rerender({ id: 100 });
        expect(result.current.pollExhausted).toBe(false);

        // And the new lineup gets its own fresh poll budget (still pending →
        // it will exhaust again only after its OWN cap, proving no carryover).
        await waitFor(() => {
            expect(result.current.data?.kind).toBe('ok');
            if (result.current.data?.kind === 'ok') {
                expect(result.current.data.data.pending).toBe(true);
            }
        });
        expect(result.current.pollExhausted).toBe(false);
    }, 70_000);
});
