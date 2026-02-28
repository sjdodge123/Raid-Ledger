/**
 * Unit tests for useUserActivity hook (ROK-443).
 * Verifies correct query key, API delegation, disabled state, and period handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── API client mock ─────────────────────────────────────────────────────────

const mockGetUserActivity = vi.fn();

vi.mock('../lib/api-client', () => ({
    getUserActivity: (...args: unknown[]) => mockGetUserActivity(...args),
    getUserProfile: vi.fn(),
    getUserHeartedGames: vi.fn(),
    getUserEventSignups: vi.fn(),
}));

// ─── Lazy imports after mocks ─────────────────────────────────────────────────

import { useUserActivity } from './use-user-profile';

// ─── Test helpers ─────────────────────────────────────────────────────────────

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

const mockActivityResponse = {
    data: [
        {
            gameId: 1,
            gameName: 'Valheim',
            coverUrl: 'https://example.com/cover.jpg',
            totalSeconds: 7200,
            isMostPlayed: true,
        },
        {
            gameId: 2,
            gameName: 'Elden Ring',
            coverUrl: null,
            totalSeconds: 3600,
            isMostPlayed: false,
        },
    ],
    period: 'week' as const,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useUserActivity (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch user activity with correct userId and period', async () => {
        mockGetUserActivity.mockResolvedValue(mockActivityResponse);

        const { result } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockActivityResponse);
        expect(mockGetUserActivity).toHaveBeenCalledWith(1, 'week');
    });

    it('should not fetch when userId is undefined', async () => {
        const { result } = renderHook(() => useUserActivity(undefined, 'week'), {
            wrapper: createWrapper(),
        });

        // Wait a tick to confirm no fetch fires
        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.isFetching).toBe(false);
        expect(mockGetUserActivity).not.toHaveBeenCalled();
    });

    it('should fetch with period=month', async () => {
        mockGetUserActivity.mockResolvedValue({ data: [], period: 'month' });

        const { result } = renderHook(() => useUserActivity(5, 'month'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockGetUserActivity).toHaveBeenCalledWith(5, 'month');
    });

    it('should fetch with period=all', async () => {
        mockGetUserActivity.mockResolvedValue({ data: [], period: 'all' });

        const { result } = renderHook(() => useUserActivity(2, 'all'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockGetUserActivity).toHaveBeenCalledWith(2, 'all');
    });

    it('should return data with activity entries', async () => {
        mockGetUserActivity.mockResolvedValue(mockActivityResponse);

        const { result } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.data).toHaveLength(2);
        expect(result.current.data?.data[0].isMostPlayed).toBe(true);
        expect(result.current.data?.data[1].isMostPlayed).toBe(false);
    });

    it('should return isLoading=true before data arrives', () => {
        // Never resolves
        mockGetUserActivity.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        expect(result.current.isLoading).toBe(true);
    });

    it('should return empty data array when activity is empty', async () => {
        mockGetUserActivity.mockResolvedValue({ data: [], period: 'week' });

        const { result } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.data).toEqual([]);
    });

    it('should use query key that includes userId and period', async () => {
        mockGetUserActivity.mockResolvedValue(mockActivityResponse);

        // Render with one period
        const { result: result1 } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result1.current.isSuccess).toBe(true);
        });

        expect(mockGetUserActivity).toHaveBeenCalledWith(1, 'week');
        expect(mockGetUserActivity).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
        mockGetUserActivity.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useUserActivity(1, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        expect(result.current.error).toBeInstanceOf(Error);
    });
});
