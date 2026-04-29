import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signupForEvent, cancelSignup, confirmSignup, updateSignupStatus } from '../lib/api-client';
import type { UpdateSignupStatusDto } from '@raid-ledger/contract';
import { invalidateRosterQueries } from './use-roster';

/**
 * Hook for signing up to an event
 * ROK-183: Supports optional slot preference for direct assignment
 * ROK-439: Supports optional characterId for selection-first signup
 */
export function useSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (options?: { note?: string; slotRole?: string; slotPosition?: number; characterId?: string; preferredRoles?: string[] }) =>
            signupForEvent(eventId, options),
        onSuccess: () => invalidateRosterQueries(queryClient, eventId),
    });
}

/**
 * Hook for canceling signup
 */
export function useCancelSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => cancelSignup(eventId),
        onSuccess: () => invalidateRosterQueries(queryClient, eventId),
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
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'], exact: true });
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'detail'], exact: true });
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
        mutationFn: (status: UpdateSignupStatusDto['status']) =>
            updateSignupStatus(eventId, status),
        onSuccess: () => invalidateRosterQueries(queryClient, eventId),
    });
}
