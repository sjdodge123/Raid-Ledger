import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const mockFetchApi = vi.fn();
const mockSetAccessToken = vi.fn();

vi.mock('../lib/api-client', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));
vi.mock('../lib/api/access-token-store', () => ({
    setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
}));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useOnboarding } from './use-onboarding';

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useOnboarding(), { wrapper }).result;
}

describe('useOnboarding changePassword (ROK-1810)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('adopts the re-issued access token the server returns', async () => {
        mockFetchApi.mockImplementation((path: string) =>
            Promise.resolve(path === '/admin/onboarding/change-password'
                ? { success: true, message: 'ok', access_token: 'fresh.jwt' }
                : {}));
        const result = setup();
        act(() => { result.current.changePassword.mutate({ currentPassword: 'a', newPassword: 'b' }); });
        await waitFor(() => expect(result.current.changePassword.isSuccess).toBe(true));
        expect(mockSetAccessToken).toHaveBeenCalledWith('fresh.jwt');
    });
});
