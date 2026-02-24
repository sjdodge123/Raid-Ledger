import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RosterWithAssignments, RosterAssignmentResponse, UpdateRosterDto } from '@raid-ledger/contract';
import { getRosterWithAssignments, updateRoster, selfUnassignFromRoster, adminRemoveUserFromEvent } from '../lib/api-client';

interface MutationContext {
    previousRoster?: RosterWithAssignments;
}

/**
 * Query hook for fetching roster with assignments (ROK-114).
 * Returns pool and assigned users for the RosterBuilder component.
 */
export function useRoster(eventId: number) {
    return useQuery<RosterWithAssignments>({
        queryKey: ['events', eventId, 'roster', 'assignments'],
        queryFn: () => getRosterWithAssignments(eventId),
    });
}

/**
 * Mutation hook for updating roster assignments (ROK-114).
 * Supports optimistic updates for immediate UI feedback during drag-and-drop.
 */
export function useUpdateRoster(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<RosterWithAssignments, Error, UpdateRosterDto, MutationContext>({
        mutationFn: (dto) => updateRoster(eventId, dto),
        // Optimistic update: immediately update UI while request is in flight
        onMutate: async () => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({
                queryKey: ['events', eventId, 'roster', 'assignments'],
            });

            // Snapshot the previous value
            const previousRoster = queryClient.getQueryData<RosterWithAssignments>([
                'events',
                eventId,
                'roster',
                'assignments',
            ]);

            return { previousRoster };
        },
        // On error, roll back to the previous value
        onError: (_err, _dto, context) => {
            if (context?.previousRoster) {
                queryClient.setQueryData(
                    ['events', eventId, 'roster', 'assignments'],
                    context.previousRoster,
                );
            }
        },
        // Always refetch after success or error
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster', 'assignments'],
            });
            // Also invalidate the regular roster query
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster'],
            });
        },
    });
}

/**
 * Mutation hook for self-unassigning from a roster slot (ROK-226).
 * User stays signed up but moves back to the unassigned pool.
 */
export function useSelfUnassign(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<RosterWithAssignments, Error, void>({
        mutationFn: () => selfUnassignFromRoster(eventId),
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster', 'assignments'],
            });
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster'],
            });
        },
    });
}

/**
 * Mutation hook for admin-removing a signup from an event (ROK-402).
 * Deletes the signup and roster assignment entirely.
 * Works for both registered users and anonymous PUG participants.
 */
export function useAdminRemoveUser(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<void, Error, number>({
        mutationFn: (signupId: number) => adminRemoveUserFromEvent(eventId, signupId),
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster', 'assignments'],
            });
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'roster'],
            });
        },
    });
}

/**
 * Helper to build UpdateRosterDto from component state.
 * ROK-461: characterId map allows admin assignment to set a character on the signup.
 */
export function buildRosterUpdate(
    _pool: RosterAssignmentResponse[],
    assignments: RosterAssignmentResponse[],
    characterIdMap?: Map<number, string>,
): UpdateRosterDto {
    return {
        assignments: assignments
            .filter((a) => a.userId > 0)
            .map((a) => ({
                userId: a.userId,
                signupId: a.signupId,
                slot: a.slot,
                position: a.position,
                isOverride: a.isOverride,
                characterId: characterIdMap?.get(a.signupId),
            })),
    };
}
