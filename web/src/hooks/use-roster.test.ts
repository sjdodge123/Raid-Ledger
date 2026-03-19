import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- API client mocks ---
const mockGetRosterWithAssignments = vi.fn();

vi.mock('../lib/api-client', () => ({
    getRosterWithAssignments: (...args: unknown[]) =>
        mockGetRosterWithAssignments(...args),
    updateRoster: vi.fn(),
    selfUnassignFromRoster: vi.fn(),
    adminRemoveUserFromEvent: vi.fn(),
}));

import { useRoster, rosterKey } from './use-roster';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
        },
    });
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return { queryClient, wrapper };
}

describe('useRoster (ROK-914)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not fire query when eventId is 0', async () => {
        const { wrapper } = createWrapper();
        mockGetRosterWithAssignments.mockResolvedValue({
            eventId: 0, pool: [], assignments: [], slots: undefined,
        });

        renderHook(() => useRoster(0), { wrapper });

        // Wait a tick to ensure no async query fires
        await new Promise((r) => setTimeout(r, 50));
        expect(mockGetRosterWithAssignments).not.toHaveBeenCalled();
    });

    it('fires query when eventId is a positive number', async () => {
        const { wrapper } = createWrapper();
        mockGetRosterWithAssignments.mockResolvedValue({
            eventId: 42, pool: [], assignments: [], slots: undefined,
        });

        const { result } = renderHook(() => useRoster(42), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetRosterWithAssignments).toHaveBeenCalledWith(42);
    });

    it('does not fire query when eventId is negative', async () => {
        const { wrapper } = createWrapper();

        renderHook(() => useRoster(-1), { wrapper });

        await new Promise((r) => setTimeout(r, 50));
        expect(mockGetRosterWithAssignments).not.toHaveBeenCalled();
    });

    it('fires query at the boundary: eventId of 1 is enabled', async () => {
        const { wrapper } = createWrapper();
        mockGetRosterWithAssignments.mockResolvedValue({
            eventId: 1, pool: [], assignments: [], slots: undefined,
        });

        const { result } = renderHook(() => useRoster(1), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetRosterWithAssignments).toHaveBeenCalledWith(1);
    });

    it('query is disabled (not fetching) when eventId is 0', () => {
        const { wrapper } = createWrapper();

        const { result } = renderHook(() => useRoster(0), { wrapper });

        expect(result.current.fetchStatus).toBe('idle');
        expect(result.current.isLoading).toBe(false);
    });

    it('passes the correct eventId to the API client', async () => {
        const { wrapper } = createWrapper();
        mockGetRosterWithAssignments.mockResolvedValue({
            eventId: 77, pool: [], assignments: [], slots: undefined,
        });

        const { result } = renderHook(() => useRoster(77), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetRosterWithAssignments).toHaveBeenCalledTimes(1);
        expect(mockGetRosterWithAssignments).toHaveBeenCalledWith(77);
    });
});

describe('rosterKey (ROK-914)', () => {
    it('returns the expected query key tuple for an event', () => {
        const key = rosterKey(42);

        expect(key).toEqual(['events', 42, 'roster', 'assignments']);
    });

    it('returns a key that matches the useRoster queryKey structure', () => {
        const key = rosterKey(5);

        expect(key[0]).toBe('events');
        expect(key[1]).toBe(5);
        expect(key[2]).toBe('roster');
        expect(key[3]).toBe('assignments');
    });
});
