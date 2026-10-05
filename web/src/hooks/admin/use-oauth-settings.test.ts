/**
 * ROK-1702 (D5): the bot invite URL falls back to the saved Discord OAuth client
 * id, so saving or clearing the OAuth config must refresh the invite query —
 * otherwise the panel keeps a stale "pending" note for up to its 60s staleTime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const adminFetchMock = vi.fn();
vi.mock('./admin-fetch', () => ({ adminFetch: (...a: unknown[]) => adminFetchMock(...a) }));
vi.mock('../use-auth', () => ({ getAuthToken: () => null }));

import { useOAuthSettings } from './use-oauth-settings';
import { BOT_INVITE_KEY } from './use-lfg-board-settings';

function setup() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useOAuthSettings(), { wrapper });
    return { result, invalidate };
}

function invalidatedKeys(invalidate: ReturnType<typeof vi.spyOn>): unknown[] {
    return invalidate.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey);
}

describe('useOAuthSettings — invite URL refresh (ROK-1702)', () => {
    beforeEach(() => {
        adminFetchMock.mockReset();
        adminFetchMock.mockResolvedValue({ success: true, message: 'ok' });
    });

    it('saving the OAuth config invalidates the bot invite URL query', async () => {
        const { result, invalidate } = setup();
        await act(async () => {
            await result.current.updateOAuth.mutateAsync({
                clientId: '4242', clientSecret: 'test-secret', callbackUrl: 'http://localhost/cb',
            });
        });
        expect(invalidatedKeys(invalidate)).toContainEqual([...BOT_INVITE_KEY]);
    });

    it('clearing the OAuth config invalidates the bot invite URL query', async () => {
        const { result, invalidate } = setup();
        await act(async () => {
            await result.current.clearOAuth.mutateAsync();
        });
        expect(invalidatedKeys(invalidate)).toContainEqual([...BOT_INVITE_KEY]);
    });
});
