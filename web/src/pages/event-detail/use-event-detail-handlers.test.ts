/**
 * Tests for ROK-548: useSlotClickHandler must not pass preferredRoles
 * for non-MMO roles like 'player', 'flex', or 'bench'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

// ---- API client mocks -------------------------------------------------------

const mockSignupForEvent = vi.fn();
const mockCancelSignup = vi.fn();
const mockUpdateSignupStatus = vi.fn();
const mockUpdateRoster = vi.fn();
const mockSelfUnassignFromRoster = vi.fn();
const mockAdminRemoveUserFromEvent = vi.fn();
const mockUpdateEvent = vi.fn();
const mockGetEventPugs = vi.fn().mockResolvedValue({ pugs: [] });
const mockCreatePugSlot = vi.fn();
const mockDeletePugSlot = vi.fn();
const mockRegeneratePugInviteCode = vi.fn();
const mockDeleteEvent = vi.fn();
const mockDeleteSeries = vi.fn();
const mockCancelSeries = vi.fn();

vi.mock('../../lib/api-client', () => ({
    signupForEvent: (...args: unknown[]) => mockSignupForEvent(...args),
    cancelSignup: (...args: unknown[]) => mockCancelSignup(...args),
    updateSignupStatus: (...args: unknown[]) => mockUpdateSignupStatus(...args),
    updateRoster: (...args: unknown[]) => mockUpdateRoster(...args),
    selfUnassignFromRoster: (...args: unknown[]) =>
        mockSelfUnassignFromRoster(...args),
    adminRemoveUserFromEvent: (...args: unknown[]) =>
        mockAdminRemoveUserFromEvent(...args),
    updateEvent: (...args: unknown[]) => mockUpdateEvent(...args),
    getEventPugs: (...args: unknown[]) => mockGetEventPugs(...args),
    createPugSlot: (...args: unknown[]) => mockCreatePugSlot(...args),
    deletePugSlot: (...args: unknown[]) => mockDeletePugSlot(...args),
    regeneratePugInviteCode: (...args: unknown[]) =>
        mockRegeneratePugInviteCode(...args),
    deleteEvent: (...args: unknown[]) => mockDeleteEvent(...args),
    deleteSeries: (...args: unknown[]) => mockDeleteSeries(...args),
    cancelSeries: (...args: unknown[]) => mockCancelSeries(...args),
    getRosterWithAssignments: vi.fn().mockResolvedValue({
        pool: [],
        assignments: [],
        slots: {},
    }),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { useEventDetailHandlers } from './use-event-detail-handlers';

// ---- Helpers ----------------------------------------------------------------

const EVENT_ID = 42;

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });

    function Wrapper({ children }: { children: ReactNode }) {
        return createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, null, children),
        );
    }

    return { queryClient, Wrapper };
}

function renderHandlers(opts: {
    isAuthenticated?: boolean;
    shouldShowCharacterModal?: boolean;
    canManageRoster?: boolean;
}) {
    const { Wrapper } = createWrapper();
    return renderHook(
        () =>
            useEventDetailHandlers(EVENT_ID, {
                isAuthenticated: opts.isAuthenticated ?? true,
                shouldShowCharacterModal:
                    opts.shouldShowCharacterModal ?? false,
                canManageRoster: opts.canManageRoster ?? false,
            }),
        { wrapper: Wrapper },
    );
}

// ---- Tests ------------------------------------------------------------------

describe('handleSlotClick — ROK-548 preferredRoles filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSignupForEvent.mockResolvedValue({
            assignedSlot: 'player',
        });
    });

    describe('without character modal', () => {
        it('includes preferredRoles when slot role is tank', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('tank', 1);
            });

            expect(mockSignupForEvent).toHaveBeenCalledWith(
                EVENT_ID,
                expect.objectContaining({
                    slotRole: 'tank',
                    slotPosition: 1,
                    preferredRoles: ['tank'],
                }),
            );
        });

        it('includes preferredRoles when slot role is healer', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('healer', 2);
            });

            expect(mockSignupForEvent).toHaveBeenCalledWith(
                EVENT_ID,
                expect.objectContaining({
                    preferredRoles: ['healer'],
                }),
            );
        });

        it('includes preferredRoles when slot role is dps', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('dps', 3);
            });

            expect(mockSignupForEvent).toHaveBeenCalledWith(
                EVENT_ID,
                expect.objectContaining({
                    preferredRoles: ['dps'],
                }),
            );
        });

        it('does NOT include preferredRoles when slot role is player', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('player', 1);
            });

            expect(mockSignupForEvent).toHaveBeenCalledWith(
                EVENT_ID,
                expect.objectContaining({
                    slotRole: 'player',
                    slotPosition: 1,
                }),
            );
            const callArg = mockSignupForEvent.mock.calls[0][1];
            expect(callArg.preferredRoles).toBeUndefined();
        });

        it('does NOT include preferredRoles when slot role is flex', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('flex', 2);
            });

            const callArg = mockSignupForEvent.mock.calls[0][1];
            expect(callArg.preferredRoles).toBeUndefined();
        });

        it('does NOT include preferredRoles when slot role is bench', async () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: false,
            });

            await act(async () => {
                result.current.handleSlotClick('bench', 1);
            });

            expect(mockSignupForEvent).toHaveBeenCalledWith(
                EVENT_ID,
                expect.objectContaining({
                    slotRole: 'bench',
                    slotPosition: 1,
                }),
            );
            const callArg = mockSignupForEvent.mock.calls[0][1];
            expect(callArg.preferredRoles).toBeUndefined();
        });
    });

    describe('with character modal', () => {
        it('sets preSelectedRole for MMO roles', () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: true,
            });

            act(() => {
                result.current.handleSlotClick('tank', 1);
            });

            expect(result.current.preSelectedRole).toBe('tank');
            expect(result.current.showConfirmModal).toBe(true);
            // No API call -- modal opens instead
            expect(mockSignupForEvent).not.toHaveBeenCalled();
        });

        it('sets preSelectedRole to undefined for non-MMO roles', () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: true,
            });

            act(() => {
                result.current.handleSlotClick('player', 1);
            });

            expect(result.current.preSelectedRole).toBeUndefined();
            expect(result.current.showConfirmModal).toBe(true);
            expect(mockSignupForEvent).not.toHaveBeenCalled();
        });

        it('sets preSelectedRole to undefined for flex', () => {
            const { result } = renderHandlers({
                shouldShowCharacterModal: true,
            });

            act(() => {
                result.current.handleSlotClick('flex', 3);
            });

            expect(result.current.preSelectedRole).toBeUndefined();
            expect(result.current.pendingSlot).toEqual({
                role: 'flex',
                position: 3,
            });
        });
    });

    describe('guard conditions', () => {
        it('does nothing when not authenticated', async () => {
            const { result } = renderHandlers({
                isAuthenticated: false,
            });

            await act(async () => {
                result.current.handleSlotClick('tank', 1);
            });

            expect(mockSignupForEvent).not.toHaveBeenCalled();
        });
    });
});
