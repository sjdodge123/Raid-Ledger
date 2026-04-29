import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
    PugSlotListResponseDto,
    PugSlotResponseDto,
    CreatePugSlotDto,
    UpdatePugSlotDto,
} from '@raid-ledger/contract';
import {
    getEventPugs,
    createPugSlot,
    updatePugSlot,
    deletePugSlot,
    regeneratePugInviteCode,
} from '../lib/api-client';

/**
 * Query hook for fetching PUG slots for an event (ROK-262).
 */
export function usePugs(eventId: number) {
    return useQuery<PugSlotListResponseDto>({
        queryKey: ['events', eventId, 'pugs'],
        queryFn: () => getEventPugs(eventId),
    });
}

function invalidatePugQueries(queryClient: ReturnType<typeof useQueryClient>, eventId: number): void {
    queryClient.invalidateQueries({ queryKey: ['events', eventId, 'pugs'] });
    queryClient.invalidateQueries({ queryKey: ['events', eventId, 'detail'], exact: true });
}

/**
 * Mutation hook for creating a PUG slot (ROK-262).
 */
export function useCreatePug(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<PugSlotResponseDto, Error, CreatePugSlotDto>({
        mutationFn: (dto) => createPugSlot(eventId, dto),
        onSuccess: () => invalidatePugQueries(queryClient, eventId),
    });
}

/**
 * Mutation hook for updating a PUG slot (ROK-262).
 */
export function useUpdatePug(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<
        PugSlotResponseDto,
        Error,
        { pugId: string; dto: UpdatePugSlotDto }
    >({
        mutationFn: ({ pugId, dto }) => updatePugSlot(eventId, pugId, dto),
        onSuccess: () => invalidatePugQueries(queryClient, eventId),
    });
}

/**
 * Mutation hook for deleting a PUG slot (ROK-262).
 */
export function useDeletePug(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<void, Error, string>({
        mutationFn: (pugId) => deletePugSlot(eventId, pugId),
        onSuccess: () => invalidatePugQueries(queryClient, eventId),
    });
}

/**
 * Mutation hook for regenerating a PUG slot invite code (ROK-263).
 */
export function useRegeneratePugInviteCode(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<PugSlotResponseDto, Error, string>({
        mutationFn: (pugId) => regeneratePugInviteCode(eventId, pugId),
        onSuccess: () => invalidatePugQueries(queryClient, eventId),
    });
}
