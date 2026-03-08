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
/** Build the roster assignments query key for a given event. */
export function rosterKey(eventId: number) {
    return ['events', eventId, 'roster', 'assignments'] as const;
}

/**
 * Invalidate both roster query caches using exact key match.
 * ROK-704: Using exact: true prevents prefix-match cascade where
 * invalidating ['events', id, 'roster'] would also match
 * ['events', id, 'roster', 'assignments'], causing double refetches.
 */
export function invalidateRosterQueries(queryClient: ReturnType<typeof useQueryClient>, eventId: number): void {
    queryClient.invalidateQueries({ queryKey: rosterKey(eventId), exact: true });
    queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'], exact: true });
}

export function useUpdateRoster(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<RosterWithAssignments, Error, UpdateRosterDto, MutationContext>({
        mutationFn: (dto) => updateRoster(eventId, dto),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: rosterKey(eventId) });
            const previousRoster = queryClient.getQueryData<RosterWithAssignments>(rosterKey(eventId));
            return { previousRoster };
        },
        onError: (_err, _dto, context) => {
            if (context?.previousRoster) queryClient.setQueryData(rosterKey(eventId), context.previousRoster);
        },
        onSettled: () => invalidateRosterQueries(queryClient, eventId),
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
        onSettled: () => invalidateRosterQueries(queryClient, eventId),
    });
}

/**
 * Mutation hook for admin-removing a signup from an event (ROK-402).
 */
export function useAdminRemoveUser(eventId: number) {
    const queryClient = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: (signupId: number) => adminRemoveUserFromEvent(eventId, signupId),
        onSettled: () => invalidateRosterQueries(queryClient, eventId),
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
