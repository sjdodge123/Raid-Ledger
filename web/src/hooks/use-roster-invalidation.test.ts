import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- API client mocks ---
const mockGetRosterWithAssignments = vi.fn();
const mockUpdateRoster = vi.fn();
const mockSelfUnassignFromRoster = vi.fn();
const mockAdminRemoveUserFromEvent = vi.fn();
const mockSignupForEvent = vi.fn();
const mockCancelSignup = vi.fn();
const mockConfirmSignup = vi.fn();
const mockUpdateSignupStatus = vi.fn();

vi.mock('../lib/api-client', () => ({
    getRosterWithAssignments: (...args: unknown[]) =>
        mockGetRosterWithAssignments(...args),
    updateRoster: (...args: unknown[]) => mockUpdateRoster(...args),
    selfUnassignFromRoster: (...args: unknown[]) =>
        mockSelfUnassignFromRoster(...args),
    adminRemoveUserFromEvent: (...args: unknown[]) =>
        mockAdminRemoveUserFromEvent(...args),
    signupForEvent: (...args: unknown[]) => mockSignupForEvent(...args),
    cancelSignup: (...args: unknown[]) => mockCancelSignup(...args),
    confirmSignup: (...args: unknown[]) => mockConfirmSignup(...args),
    updateSignupStatus: (...args: unknown[]) =>
        mockUpdateSignupStatus(...args),
}));

import { useUpdateRoster, useSelfUnassign, useAdminRemoveUser } from './use-roster';
import { useSignup, useCancelSignup, useConfirmSignup, useUpdateSignupStatus } from './use-signups';

// --- Helpers ---

const ROSTER_KEY = ['events', 1, 'roster'] as const;
const ASSIGNMENTS_KEY = ['events', 1, 'roster', 'assignments'] as const;

function createTestHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });

    // Seed both query caches so invalidation triggers can be observed
    queryClient.setQueryData([...ROSTER_KEY], { signups: [] });
    queryClient.setQueryData([...ASSIGNMENTS_KEY], { pool: [], assignments: [], slots: {} });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    return { queryClient, invalidateSpy, wrapper };
}

// --- Tests ---

function rosterMutationExactInvalidation() {
    it('useUpdateRoster invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockUpdateRoster.mockResolvedValue({ pool: [], assignments: [], slots: {} });

        const { result } = renderHook(() => useUpdateRoster(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ assignments: [] });
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        // Each key should be invalidated exactly once with exact: true
        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });

    it('useSelfUnassign invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockSelfUnassignFromRoster.mockResolvedValue({ pool: [], assignments: [], slots: {} });

        const { result } = renderHook(() => useSelfUnassign(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });

    it('useAdminRemoveUser invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockAdminRemoveUserFromEvent.mockResolvedValue(undefined);

        const { result } = renderHook(() => useAdminRemoveUser(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync(42);
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });
}

function signupAndCancelExactInvalidation() {
    it('useSignup invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockSignupForEvent.mockResolvedValue({});

        const { result } = renderHook(() => useSignup(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });

    it('useCancelSignup invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockCancelSignup.mockResolvedValue({});

        const { result } = renderHook(() => useCancelSignup(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });
}

function confirmAndStatusExactInvalidation() {
    it('useConfirmSignup invalidates roster key with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockConfirmSignup.mockResolvedValue({});

        const { result } = renderHook(() => useConfirmSignup(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ signupId: 10, characterId: 'char-1' });
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
    });

    it('useUpdateSignupStatus invalidates roster and assignments keys with exact: true', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();
        mockUpdateSignupStatus.mockResolvedValue({});

        const { result } = renderHook(() => useUpdateSignupStatus(1), { wrapper });

        await act(async () => {
            await result.current.mutateAsync('tentative');
        });

        const rosterCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ROSTER_KEY]),
        );
        const assignmentsCalls = invalidateSpy.mock.calls.filter(
            ([opts]) => JSON.stringify(opts?.queryKey) === JSON.stringify([...ASSIGNMENTS_KEY]),
        );

        expect(rosterCalls).toHaveLength(1);
        expect(rosterCalls[0][0]).toHaveProperty('exact', true);
        expect(assignmentsCalls).toHaveLength(1);
        expect(assignmentsCalls[0][0]).toHaveProperty('exact', true);
    });
}

describe('Roster query invalidation (ROK-704)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('use-roster mutations use exact invalidation', () => {
        rosterMutationExactInvalidation();
    });

    describe('use-signups mutations use exact invalidation', () => {
        signupAndCancelExactInvalidation();
        confirmAndStatusExactInvalidation();
    });
});
