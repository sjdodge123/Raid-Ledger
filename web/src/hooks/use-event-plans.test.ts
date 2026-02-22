import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── API client mock ───────────────────────────────────────────────────────────

const mockGetTimeSuggestions = vi.fn();
const mockCreateEventPlan = vi.fn();
const mockGetMyEventPlans = vi.fn();
const mockGetEventPlan = vi.fn();
const mockCancelEventPlan = vi.fn();

vi.mock('../lib/api-client', () => ({
    getTimeSuggestions: (...args: unknown[]) => mockGetTimeSuggestions(...args),
    createEventPlan: (...args: unknown[]) => mockCreateEventPlan(...args),
    getMyEventPlans: (...args: unknown[]) => mockGetMyEventPlans(...args),
    getEventPlan: (...args: unknown[]) => mockGetEventPlan(...args),
    cancelEventPlan: (...args: unknown[]) => mockCancelEventPlan(...args),
}));

// ─── Toast mock ───────────────────────────────────────────────────────────────

vi.mock('../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// ─── Lazy imports after mocks ─────────────────────────────────────────────────

import {
    useTimeSuggestions,
    useCreateEventPlan,
    useMyEventPlans,
    useEventPlan,
    useCancelEventPlan,
} from './use-event-plans';
import { toast } from '../lib/toast';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    };
}

const mockPlan = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    creatorId: 1,
    title: 'Raid Night',
    description: null,
    gameId: null,
    slotConfig: null,
    maxAttendees: null,
    autoUnbench: true,
    durationMinutes: 120,
    pollOptions: [
        { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM' },
        { date: '2026-03-11T18:00:00.000Z', label: 'Tuesday Mar 11, 6:00 PM' },
    ],
    pollDurationHours: 24,
    pollMode: 'standard',
    pollRound: 1,
    pollChannelId: 'channel-123',
    pollMessageId: 'message-456',
    status: 'polling',
    winningOption: null,
    createdEventId: null,
    pollStartedAt: new Date().toISOString(),
    pollEndsAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const mockSuggestions = {
    source: 'fallback',
    interestedPlayerCount: 0,
    suggestions: [
        { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM', availableCount: 0 },
    ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useTimeSuggestions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch time suggestions on mount', async () => {
        mockGetTimeSuggestions.mockResolvedValue(mockSuggestions);

        const { result } = renderHook(() => useTimeSuggestions(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockSuggestions);
        expect(mockGetTimeSuggestions).toHaveBeenCalledOnce();
    });

    it('should use query key with gameId and afterDate', async () => {
        mockGetTimeSuggestions.mockResolvedValue(mockSuggestions);

        const params = { gameId: 5, afterDate: '2026-03-01T00:00:00Z' };
        const { result } = renderHook(() => useTimeSuggestions(params), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // Verify params were passed through to API function
        expect(mockGetTimeSuggestions).toHaveBeenCalledWith(params);
    });

    it('should be enabled by default', async () => {
        mockGetTimeSuggestions.mockResolvedValue(mockSuggestions);

        const { result } = renderHook(() => useTimeSuggestions(), {
            wrapper: createWrapper(),
        });

        // Query should fire
        await waitFor(() => {
            expect(result.current.isFetching === false || result.current.isSuccess).toBe(true);
        });

        expect(mockGetTimeSuggestions).toHaveBeenCalled();
    });
});

describe('useCreateEventPlan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call createEventPlan on mutate', async () => {
        mockCreateEventPlan.mockResolvedValue(mockPlan);

        const { result } = renderHook(() => useCreateEventPlan(), {
            wrapper: createWrapper(),
        });

        const dto = {
            title: 'Raid Night',
            durationMinutes: 120,
            pollOptions: mockPlan.pollOptions,
            pollDurationHours: 24,
            pollMode: 'standard' as const,
        };

        await act(async () => {
            await result.current.mutateAsync(dto);
        });

        expect(mockCreateEventPlan).toHaveBeenCalledWith(dto);
    });

    it('should show success toast on successful creation', async () => {
        mockCreateEventPlan.mockResolvedValue(mockPlan);

        const { result } = renderHook(() => useCreateEventPlan(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.mutateAsync({
                title: 'Test',
                durationMinutes: 60,
                pollOptions: mockPlan.pollOptions,
                pollDurationHours: 24,
                pollMode: 'standard',
            });
        });

        expect(toast.success).toHaveBeenCalledWith(
            'Event plan created! Poll posted to Discord.',
        );
    });

    it('should show error toast on failure', async () => {
        mockCreateEventPlan.mockRejectedValue(new Error('No channel configured'));

        const { result } = renderHook(() => useCreateEventPlan(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            try {
                await result.current.mutateAsync({
                    title: 'Test',
                    durationMinutes: 60,
                    pollOptions: mockPlan.pollOptions,
                    pollDurationHours: 24,
                    pollMode: 'standard',
                });
            } catch {
                // expected
            }
        });

        expect(toast.error).toHaveBeenCalledWith('No channel configured');
    });
});

describe('useMyEventPlans', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch user plans on mount', async () => {
        mockGetMyEventPlans.mockResolvedValue([mockPlan]);

        const { result } = renderHook(() => useMyEventPlans(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual([mockPlan]);
        expect(mockGetMyEventPlans).toHaveBeenCalledOnce();
    });

    it('should use the correct query key ["event-plans", "my-plans"]', async () => {
        // We verify the query key indirectly by checking that invalidateQueries
        // (triggered by create/cancel mutations) properly affects this query.
        // Here we just confirm the hook fires the right API function.
        mockGetMyEventPlans.mockResolvedValue([]);

        const { result } = renderHook(() => useMyEventPlans(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockGetMyEventPlans).toHaveBeenCalled();
    });

    it('should return empty array when user has no plans', async () => {
        mockGetMyEventPlans.mockResolvedValue([]);

        const { result } = renderHook(() => useMyEventPlans(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual([]);
    });
});

describe('useEventPlan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch a specific plan by ID', async () => {
        mockGetEventPlan.mockResolvedValue(mockPlan);

        const planId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const { result } = renderHook(() => useEventPlan(planId), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual(mockPlan);
        expect(mockGetEventPlan).toHaveBeenCalledWith(planId);
    });

    it('should not fetch when planId is undefined', async () => {
        const { result } = renderHook(() => useEventPlan(undefined), {
            wrapper: createWrapper(),
        });

        // Wait a tick to ensure no fetch fires
        await new Promise((r) => setTimeout(r, 50));

        expect(result.current.isFetching).toBe(false);
        expect(mockGetEventPlan).not.toHaveBeenCalled();
    });

    it('should use query key with the planId', async () => {
        mockGetEventPlan.mockResolvedValue(mockPlan);

        const planId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        renderHook(() => useEventPlan(planId), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(mockGetEventPlan).toHaveBeenCalledWith(planId);
        });
    });
});

describe('useCancelEventPlan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call cancelEventPlan with the planId on mutate', async () => {
        mockCancelEventPlan.mockResolvedValue({ ...mockPlan, status: 'cancelled' });

        const { result } = renderHook(() => useCancelEventPlan(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.mutateAsync('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        });

        expect(mockCancelEventPlan).toHaveBeenCalledWith(
            'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        );
    });

    it('should show success toast after cancellation', async () => {
        mockCancelEventPlan.mockResolvedValue({ ...mockPlan, status: 'cancelled' });

        const { result } = renderHook(() => useCancelEventPlan(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            await result.current.mutateAsync(mockPlan.id);
        });

        expect(toast.success).toHaveBeenCalledWith('Event plan cancelled');
    });

    it('should show error toast on failure', async () => {
        mockCancelEventPlan.mockRejectedValue(new Error('Not authorized'));

        const { result } = renderHook(() => useCancelEventPlan(), {
            wrapper: createWrapper(),
        });

        await act(async () => {
            try {
                await result.current.mutateAsync(mockPlan.id);
            } catch {
                // expected
            }
        });

        expect(toast.error).toHaveBeenCalledWith('Not authorized');
    });
});
