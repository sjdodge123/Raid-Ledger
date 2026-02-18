import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signupForEvent, cancelSignup, confirmSignup, updateSignupStatus } from '../lib/api-client';
import type { SignupStatus } from '@raid-ledger/contract';

/**
 * Hook for signing up to an event
 * ROK-183: Supports optional slot preference for direct assignment
 */
export function useSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (options?: { note?: string; slotRole?: string; slotPosition?: number }) =>
            signupForEvent(eventId, options),
        onSuccess: () => {
            // Invalidate roster query to refetch updated roster
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'] });
            // Also invalidate roster assignments for RosterBuilder
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster', 'assignments'] });
        },
    });
}

/**
 * Hook for canceling signup
 */
export function useCancelSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => cancelSignup(eventId),
        onSuccess: () => {
            // Invalidate roster query to refetch updated roster
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'] });
            // Also invalidate roster assignments for RosterBuilder
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster', 'assignments'] });
        },
    });
}

/**
 * Hook for confirming signup with character selection (ROK-131)
 */
export function useConfirmSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ signupId, characterId }: { signupId: number; characterId: string }) =>
            confirmSignup(eventId, signupId, characterId),
        onSuccess: () => {
            // Invalidate roster query to refetch updated roster with character info
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'] });
        },
    });
}

/**
 * Hook for updating signup status (ROK-137)
 * Supports: signed_up, tentative, declined
 */
export function useUpdateSignupStatus(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (status: SignupStatus) =>
            updateSignupStatus(eventId, status),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'] });
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster', 'assignments'] });
        },
    });
}
