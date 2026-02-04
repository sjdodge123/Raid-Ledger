import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signupForEvent, cancelSignup, confirmSignup } from '../lib/api-client';

/**
 * Hook for signing up to an event
 */
export function useSignup(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (note?: string) => signupForEvent(eventId, note),
        onSuccess: () => {
            // Invalidate roster query to refetch updated roster
            queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'] });
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
