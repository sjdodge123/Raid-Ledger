import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAggregateGameTime, rescheduleEvent } from '../lib/api-client';
import type { RescheduleEventDto } from '@raid-ledger/contract';

/**
 * Fetch aggregate game time heatmap for an event's signed-up users (ROK-223).
 */
export function useAggregateGameTime(eventId: number, enabled = true) {
    return useQuery({
        queryKey: ['events', eventId, 'aggregate-game-time'],
        queryFn: () => getAggregateGameTime(eventId),
        enabled,
    });
}

/**
 * Reschedule an event mutation (ROK-223).
 * Invalidates event queries on success.
 */
export function useRescheduleEvent(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: RescheduleEventDto) => rescheduleEvent(eventId, dto),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events'] });
            queryClient.invalidateQueries({ queryKey: ['event', eventId] });
        },
    });
}
