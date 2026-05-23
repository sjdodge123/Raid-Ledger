import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';

const API_BASE = 'http://localhost:3000';

const useAuthMock = vi.fn();
const getAuthTokenMock = vi.fn<[], string | null>();

vi.mock('../use-auth', async () => {
    const actual = await vi.importActual<typeof import('../use-auth')>('../use-auth');
    return {
        ...actual,
        getAuthToken: () => getAuthTokenMock(),
        useAuth: () => useAuthMock(),
    };
});

import { useAiFeatures } from './use-ai-settings';

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

const MOCK_RESPONSE = {
    chatEnabled: true,
    dynamicCategoriesEnabled: false,
    aiSuggestionsEnabled: true,
};

function installFeaturesHandler() {
    const counter = { count: 0 };
    server.use(
        http.get(`${API_BASE}/admin/ai/features`, () => {
            counter.count += 1;
            return HttpResponse.json(MOCK_RESPONSE);
        }),
    );
    return counter;
}

describe('useAiFeatures', () => {
    beforeEach(() => {
        getAuthTokenMock.mockReset();
        useAuthMock.mockReset();
        getAuthTokenMock.mockReturnValue('test-token');
    });

    it('admin → query enabled and fetches features', async () => {
        useAuthMock.mockReturnValue({
            user: { id: 1, username: 'A', role: 'admin' },
        });
        const counter = installFeaturesHandler();

        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useAiFeatures(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.chatEnabled).toBe(true);
        expect(counter.count).toBe(1);
    });

    it('non-admin → query disabled, NO request fired', async () => {
        useAuthMock.mockReturnValue({
            user: { id: 2, username: 'M', role: 'member' },
        });
        const counter = installFeaturesHandler();

        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useAiFeatures(), { wrapper });

        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.isFetching).toBe(false);
        expect(result.current.data).toBeUndefined();
        expect(counter.count).toBe(0);
    });

    it('logged-out (no token) → query disabled', async () => {
        getAuthTokenMock.mockReturnValue(null);
        useAuthMock.mockReturnValue({ user: null });
        const counter = installFeaturesHandler();

        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useAiFeatures(), { wrapper });

        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.data).toBeUndefined();
        expect(counter.count).toBe(0);
    });

    it('auth loading (user undefined) → query disabled', async () => {
        useAuthMock.mockReturnValue({ user: undefined });
        const counter = installFeaturesHandler();

        const { wrapper } = wrapperFactory();
        const { result } = renderHook(() => useAiFeatures(), { wrapper });

        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.data).toBeUndefined();
        expect(counter.count).toBe(0);
    });
});
