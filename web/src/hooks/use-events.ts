import { useQuery } from '@tanstack/react-query';
import { getEvents, getEvent, getEventRoster } from '../lib/api-client';
import type { EventListParams } from '../lib/api-client';

/**
 * Hook to fetch paginated event list
 */
export function useEvents(params: EventListParams = { upcoming: true }) {
    return useQuery({
        queryKey: ['events', params],
        queryFn: () => getEvents(params),
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
