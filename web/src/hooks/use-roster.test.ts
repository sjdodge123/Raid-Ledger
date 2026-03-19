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

import { useRoster } from './use-roster';

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
});
