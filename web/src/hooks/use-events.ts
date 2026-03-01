import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEvents, getEvent, getEventRoster, getEventVariantContext, cancelEvent } from '../lib/api-client';
import type { EventListParams } from '../lib/api-client';
import { useInfiniteList } from './use-infinite-list';
import type { EventResponseDto } from '@raid-ledger/contract';

/**
 * Hook to fetch paginated event list.
 * Pass `undefined` to disable the query (e.g. when a dependency isn't ready yet).
 */
export function useEvents(params?: EventListParams) {
    const resolvedParams = params ?? { upcoming: true };
    return useQuery({
        queryKey: ['events', resolvedParams],
        queryFn: () => getEvents(resolvedParams),
        enabled: params !== undefined,
    });
}

/**
 * Infinite-scroll variant of useEvents (ROK-361).
 * Loads pages automatically as the user scrolls down.
 */
export function useInfiniteEvents(params?: EventListParams) {
    const resolvedParams = params ?? { upcoming: true };
    return useInfiniteList<EventResponseDto>({
        queryKey: ['events', 'infinite', resolvedParams],
        queryFn: (page) => getEvents({ ...resolvedParams, page }),
        enabled: params !== undefined,
    });
}

/**
 * Hook to fetch a single event by ID
 */
export function useEvent(eventId: number) {
    return useQuery({
        queryKey: ['events', eventId],
        queryFn: () => getEvent(eventId),
        enabled: !!eventId,
    });
}

/**
 * Hook to fetch event roster
 */
export function useEventRoster(eventId: number) {
    return useQuery({
        queryKey: ['events', eventId, 'roster'],
        queryFn: () => getEventRoster(eventId),
        enabled: !!eventId,
    });
}

/**
 * ROK-587: Hook to fetch dominant game variant/region context from an event's signups.
 * Used to auto-populate the variant selector when importing a character.
 * @param eventId - Event ID to fetch context for
 * @param enabled - Whether to enable the query (e.g., only for WoW Classic events)
 */
export function useEventVariantContext(eventId: number | undefined, enabled = true) {
    return useQuery({
        queryKey: ['events', eventId, 'variant-context'],
        queryFn: () => getEventVariantContext(eventId!),
        enabled: !!eventId && enabled,
        staleTime: 60_000, // Cache for 1 minute
    });
}

/**
 * Hook to cancel an event (ROK-374)
 */
export function useCancelEvent(eventId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (reason?: string) => cancelEvent(eventId, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events', eventId] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
        },
    });
}
