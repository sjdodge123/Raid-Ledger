import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import {
    useListDynamicCategories,
    useApproveDynamicCategory,
    useRejectDynamicCategory,
    usePatchDynamicCategory,
    useRegenerateDynamicCategories,
} from './use-dynamic-categories';

const API_BASE = 'http://localhost:3000';

vi.mock('../use-auth', () => ({
    getAuthToken: () => 'test-token',
}));

function wrapperFactory() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return { wrapper, queryClient };
}

const MOCK_SUGGESTION = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Autumn Co-op',
    description: 'Seasonal co-op pick',
    categoryType: 'seasonal',
    themeVector: [0.9, 0, 0, 0, 0, 0.6, 0],
    filterCriteria: {},
    candidateGameIds: [1, 2],
    status: 'pending',
    populationStrategy: 'vector',
    sortOrder: 1,
    expiresAt: null,
    generatedAt: '2026-04-22T00:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-04-22T00:00:00.000Z',
};

describe('useListDynamicCategories', () => {
    beforeEach(() => vi.clearAllMocks());

    it('fetches suggestions for the requested status', async () => {
        server.use(
            http.get(
                `${API_BASE}/admin/discovery-categories`,
                ({ request }) => {
                    const url = new URL(request.url);
                    expect(url.searchParams.get('status')).toBe('pending');
                    return HttpResponse.json({
                        suggestions: [MOCK_SUGGESTION],
                    });
                },
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(
            () => useListDynamicCategories('pending'),
            { wrapper },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.suggestions).toHaveLength(1);
        expect(result.current.data?.suggestions[0].name).toBe('Autumn Co-op');
    });
});

describe('useApproveDynamicCategory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('POSTs to /approve and invalidates list queries', async () => {
        let calledId: string | null = null;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/:id/approve`,
                ({ params }) => {
                    calledId = String(params.id);
                    return HttpResponse.json({
                        ...MOCK_SUGGESTION,
                        status: 'approved',
                    });
                },
            ),
        );
        const { wrapper, queryClient } = wrapperFactory();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useApproveDynamicCategory(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync(MOCK_SUGGESTION.id);
        });
        expect(calledId).toBe(MOCK_SUGGESTION.id);
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: ['admin', 'discovery-categories'],
        });
    });
});

describe('useRejectDynamicCategory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('POSTs a reject with optional reason', async () => {
        let receivedBody: Record<string, unknown> | null = null;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/:id/reject`,
                async ({ request }) => {
                    receivedBody = (await request.json()) as Record<
                        string,
                        unknown
                    >;
                    return HttpResponse.json({
                        ...MOCK_SUGGESTION,
                        status: 'rejected',
                    });
                },
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useRejectDynamicCategory(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync({
                id: MOCK_SUGGESTION.id,
                reason: 'not relevant',
            });
        });
        expect(receivedBody).toEqual({ reason: 'not relevant' });
    });

    it('omits reason when not provided', async () => {
        let receivedBody: Record<string, unknown> | null = null;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/:id/reject`,
                async ({ request }) => {
                    receivedBody = (await request.json()) as Record<
                        string,
                        unknown
                    >;
                    return HttpResponse.json({
                        ...MOCK_SUGGESTION,
                        status: 'rejected',
                    });
                },
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useRejectDynamicCategory(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync({ id: MOCK_SUGGESTION.id });
        });
        expect(receivedBody).toEqual({});
    });
});

describe('usePatchDynamicCategory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('PATCHes with the provided fields', async () => {
        let receivedBody: Record<string, unknown> | null = null;
        server.use(
            http.patch(
                `${API_BASE}/admin/discovery-categories/:id`,
                async ({ request }) => {
                    receivedBody = (await request.json()) as Record<
                        string,
                        unknown
                    >;
                    return HttpResponse.json({
                        ...MOCK_SUGGESTION,
                        name: 'renamed',
                    });
                },
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => usePatchDynamicCategory(), {
            wrapper,
        });
        await act(async () => {
            await result.current.mutateAsync({
                id: MOCK_SUGGESTION.id,
                patch: { name: 'renamed', description: 'new desc' },
            });
        });
        expect(receivedBody).toEqual({
            name: 'renamed',
            description: 'new desc',
        });
    });
});

describe('useRegenerateDynamicCategories', () => {
    beforeEach(() => vi.clearAllMocks());

    it('POSTs regenerate and returns ok', async () => {
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/regenerate`,
                () => HttpResponse.json({ ok: true }),
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(
            () => useRegenerateDynamicCategories(),
            { wrapper },
        );
        await act(async () => {
            const res = await result.current.mutateAsync();
            expect(res).toEqual({ ok: true });
        });
    });

    it('propagates 503 error when flag is off', async () => {
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/regenerate`,
                () =>
                    HttpResponse.json(
                        { message: 'Dynamic discovery categories are disabled' },
                        { status: 503 },
                    ),
            ),
        );
        const { wrapper } = wrapperFactory();
        const { result } = renderHook(
            () => useRegenerateDynamicCategories(),
            { wrapper },
        );
        let errorMessage = '';
        await act(async () => {
            try {
                await result.current.mutateAsync();
            } catch (e) {
                errorMessage = (e as Error).message;
            }
        });
        expect(errorMessage).toMatch(/disabled|Failed/i);
    });
});
