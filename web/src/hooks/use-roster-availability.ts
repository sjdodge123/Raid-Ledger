import { useQuery } from '@tanstack/react-query';
import { getRosterAvailability, type RosterAvailabilityParams } from '../lib/api-client';

/**
 * React Query hook for fetching roster availability (ROK-113).
 * Used by the heatmap grid to display team availability visualization.
 *
 * @param eventId - Event ID to fetch availability for
 * @param params - Optional time range filters
 * @param enabled - Whether to enable the query (default: true)
 */
export function useRosterAvailability(
    eventId: number,
    params?: RosterAvailabilityParams,
    enabled = true
) {
    return useQuery({
        queryKey: ['roster-availability', eventId, params?.from, params?.to],
        queryFn: () => getRosterAvailability(eventId, params),
        enabled: enabled && !!eventId,
        staleTime: 30 * 1000, // 30 seconds - availability changes less frequently
        refetchOnWindowFocus: false,
    });
}
