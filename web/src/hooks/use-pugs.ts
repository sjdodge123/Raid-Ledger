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

/**
 * Mutation hook for creating a PUG slot (ROK-262).
 */
export function useCreatePug(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<PugSlotResponseDto, Error, CreatePugSlotDto>({
        mutationFn: (dto) => createPugSlot(eventId, dto),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'pugs'],
            });
        },
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
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'pugs'],
            });
        },
    });
}

/**
 * Mutation hook for deleting a PUG slot (ROK-262).
 */
export function useDeletePug(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation<void, Error, string>({
        mutationFn: (pugId) => deletePugSlot(eventId, pugId),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['events', eventId, 'pugs'],
            });
        },
    });
}
