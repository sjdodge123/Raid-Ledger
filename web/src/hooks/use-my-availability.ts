import { useQuery } from '@tanstack/react-query';
import { getMyAvailability, type AvailabilityQueryParams } from '../lib/api-client';
import type { RosterAvailabilityResponse } from '@raid-ledger/contract';

/**
 * React Query hook for fetching current user's availability (ROK-182).
 * Transforms AvailabilityListResponseDto to RosterAvailabilityResponse format
 * for reuse with HeatmapGrid component.
 *
 * @param params - Optional date range filters (from, to)
 * @param enabled - Whether to enable the query (default: true)
 */
export function useMyAvailability(
    params?: AvailabilityQueryParams,
    enabled = true
) {
    return useQuery({
        queryKey: ['my-availability', params?.from, params?.to, params?.gameId],
        queryFn: async (): Promise<RosterAvailabilityResponse | null> => {
            const response = await getMyAvailability(params);

            // If no availability data, return null
            if (!response.data || response.data.length === 0) {
                return null;
            }

            // Transform to RosterAvailabilityResponse format for HeatmapGrid
            // For "Your Availability" on Create form, we show just the current user
            const slots = response.data.map((avail) => ({
                start: avail.timeRange.start,
                end: avail.timeRange.end,
                status: avail.status,
                gameId: avail.gameId ?? null,
                sourceEventId: avail.sourceEventId ?? null,
            }));

            // Calculate the time range from the availability data
            const times = response.data.flatMap((a) => [
                new Date(a.timeRange.start).getTime(),
                new Date(a.timeRange.end).getTime(),
            ]);
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);

            return {
                eventId: 0, // Not scoped to an event
                timeRange: {
                    start: new Date(minTime).toISOString(),
                    end: new Date(maxTime).toISOString(),
                },
                users: [
                    {
                        id: 0, // Current user (ID not needed for display)
                        username: 'You',
                        avatar: null,
                        slots,
                    },
                ],
            };
        },
        enabled: enabled && !!params?.from && !!params?.to,
        staleTime: 30 * 1000, // 30 seconds
        refetchOnWindowFocus: false,
    });
}
