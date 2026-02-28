/**
 * Unit tests for useGameActivity and useGameNowPlaying hooks (ROK-443).
 * Verifies query behavior, disabling, period changes, and data shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── API client mock ─────────────────────────────────────────────────────────

const mockGetGameActivity = vi.fn();
const mockGetGameNowPlaying = vi.fn();

vi.mock('../lib/api-client', () => ({
    getGameActivity: (...args: unknown[]) => mockGetGameActivity(...args),
    getGameNowPlaying: (...args: unknown[]) => mockGetGameNowPlaying(...args),
}));

vi.mock('./use-auth', () => ({
    getAuthToken: vi.fn().mockReturnValue(null),
}));

// ─── Lazy imports after mocks ─────────────────────────────────────────────────

import { useGameActivity, useGameNowPlaying } from './use-games-discover';

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
    topPlayers: [
        {
            userId: 1,
            username: 'PlayerOne',
            avatar: 'abc123',
            customAvatarUrl: null,
            discordId: '111',
            totalSeconds: 7200,
        },
    ],
    totalSeconds: 7200,
    period: 'week' as const,
};

const mockNowPlayingResponse = {
    players: [
        {
            userId: 2,
            username: 'ActivePlayer',
            avatar: 'def456',
            customAvatarUrl: null,
            discordId: '222',
        },
    ],
    count: 1,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useGameActivity (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch game activity with correct gameId and period', async () => {
        mockGetGameActivity.mockResolvedValue(mockActivityResponse);

        const { result } = renderHook(() => useGameActivity(42, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockActivityResponse);
        expect(mockGetGameActivity).toHaveBeenCalledWith(42, 'week');
    });

    it('should not fetch when gameId is undefined', async () => {
        const { result } = renderHook(() => useGameActivity(undefined, 'week'), {
            wrapper: createWrapper(),
        });

        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.isFetching).toBe(false);
        expect(mockGetGameActivity).not.toHaveBeenCalled();
    });

    it('should fetch with period=month', async () => {
        mockGetGameActivity.mockResolvedValue({ ...mockActivityResponse, period: 'month' });

        const { result } = renderHook(() => useGameActivity(10, 'month'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockGetGameActivity).toHaveBeenCalledWith(10, 'month');
    });

    it('should fetch with period=all', async () => {
        mockGetGameActivity.mockResolvedValue({ ...mockActivityResponse, period: 'all' });

        const { result } = renderHook(() => useGameActivity(10, 'all'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockGetGameActivity).toHaveBeenCalledWith(10, 'all');
    });

    it('should return topPlayers array from response', async () => {
        mockGetGameActivity.mockResolvedValue(mockActivityResponse);

        const { result } = renderHook(() => useGameActivity(42, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.topPlayers).toHaveLength(1);
        expect(result.current.data?.topPlayers[0].username).toBe('PlayerOne');
    });

    it('should return totalSeconds from response', async () => {
        mockGetGameActivity.mockResolvedValue(mockActivityResponse);

        const { result } = renderHook(() => useGameActivity(42, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.totalSeconds).toBe(7200);
    });

    it('should handle empty topPlayers', async () => {
        mockGetGameActivity.mockResolvedValue({
            topPlayers: [],
            totalSeconds: 0,
            period: 'week',
        });

        const { result } = renderHook(() => useGameActivity(42, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.topPlayers).toEqual([]);
        expect(result.current.data?.totalSeconds).toBe(0);
    });

    it('should handle API errors', async () => {
        mockGetGameActivity.mockRejectedValue(new Error('Game not found'));

        const { result } = renderHook(() => useGameActivity(999, 'week'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        expect(result.current.error).toBeInstanceOf(Error);
    });
});

describe('useGameNowPlaying (ROK-443)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch now-playing for a game', async () => {
        mockGetGameNowPlaying.mockResolvedValue(mockNowPlayingResponse);

        const { result } = renderHook(() => useGameNowPlaying(42), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockNowPlayingResponse);
        expect(mockGetGameNowPlaying).toHaveBeenCalledWith(42);
    });

    it('should not fetch when gameId is undefined', async () => {
        const { result } = renderHook(() => useGameNowPlaying(undefined), {
            wrapper: createWrapper(),
        });

        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.isFetching).toBe(false);
        expect(mockGetGameNowPlaying).not.toHaveBeenCalled();
    });

    it('should return players array from response', async () => {
        mockGetGameNowPlaying.mockResolvedValue(mockNowPlayingResponse);

        const { result } = renderHook(() => useGameNowPlaying(42), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.players).toHaveLength(1);
        expect(result.current.data?.players[0].username).toBe('ActivePlayer');
    });

    it('should return count from response', async () => {
        mockGetGameNowPlaying.mockResolvedValue(mockNowPlayingResponse);

        const { result } = renderHook(() => useGameNowPlaying(42), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.count).toBe(1);
    });

    it('should handle empty players list (nobody playing)', async () => {
        mockGetGameNowPlaying.mockResolvedValue({ players: [], count: 0 });

        const { result } = renderHook(() => useGameNowPlaying(42), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.players).toEqual([]);
        expect(result.current.data?.count).toBe(0);
    });

    it('should handle API errors', async () => {
        mockGetGameNowPlaying.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useGameNowPlaying(1), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        expect(result.current.error).toBeInstanceOf(Error);
    });
});
