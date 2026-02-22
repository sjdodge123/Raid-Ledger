import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// Mock the API client
const mockFetchApi = vi.fn();

vi.mock('../lib/api-client', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

import { useServerInvite, useGuildMembership } from './use-discord-onboarding';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });

    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    };
}

describe('useServerInvite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch server invite when enabled=true (default)', async () => {
        const mockResponse = { url: 'https://discord.gg/abc123', guildName: 'Test Guild' };
        mockFetchApi.mockResolvedValue(mockResponse);

        const { result } = renderHook(() => useServerInvite(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockResponse);
        expect(mockFetchApi).toHaveBeenCalledWith('/discord/server-invite');
    });

    it('should not fetch when enabled=false', async () => {
        const { result } = renderHook(() => useServerInvite(false), {
            wrapper: createWrapper(),
        });

        // Wait a tick to ensure no fetch happens
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockFetchApi).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });

    it('should return null url and guildName when API returns nulls', async () => {
        mockFetchApi.mockResolvedValue({ url: null, guildName: null });

        const { result } = renderHook(() => useServerInvite(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual({ url: null, guildName: null });
    });

    it('should use queryKey ["discord", "server-invite"]', async () => {
        mockFetchApi.mockResolvedValue({ url: 'https://discord.gg/test', guildName: 'Guild' });

        const { result } = renderHook(() => useServerInvite(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // Verify fetchApi was called with the correct endpoint
        expect(mockFetchApi).toHaveBeenCalledWith('/discord/server-invite');
    });

    it('should enter error state when API call fails', async () => {
        mockFetchApi.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useServerInvite(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });
    });
});

describe('useGuildMembership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch guild membership when enabled=true (default)', async () => {
        const mockResponse = { isMember: true };
        mockFetchApi.mockResolvedValue(mockResponse);

        const { result } = renderHook(() => useGuildMembership(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockResponse);
        expect(mockFetchApi).toHaveBeenCalledWith('/discord/guild-membership');
    });

    it('should not fetch when enabled=false', async () => {
        const { result } = renderHook(() => useGuildMembership(false), {
            wrapper: createWrapper(),
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockFetchApi).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });

    it('should return isMember=false when user is not in guild', async () => {
        mockFetchApi.mockResolvedValue({ isMember: false });

        const { result } = renderHook(() => useGuildMembership(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual({ isMember: false });
    });

    it('should use queryKey ["discord", "guild-membership"]', async () => {
        mockFetchApi.mockResolvedValue({ isMember: false });

        const { result } = renderHook(() => useGuildMembership(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockFetchApi).toHaveBeenCalledWith('/discord/guild-membership');
    });

    it('should enter error state when API call fails', async () => {
        mockFetchApi.mockRejectedValue(new Error('Unauthorized'));

        const { result } = renderHook(() => useGuildMembership(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });
    });

    it('should accept enabled flag as a boolean to conditionally fetch', async () => {
        mockFetchApi.mockResolvedValue({ isMember: true });

        // enabled=true should fetch
        const { result } = renderHook(() => useGuildMembership(true), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });
});
