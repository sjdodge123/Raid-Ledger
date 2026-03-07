import { useQuery } from '@tanstack/react-query';
import { getMyAvailability, type AvailabilityQueryParams } from '../lib/api-client';
import type { RosterAvailabilityResponse, AvailabilityStatus } from '@raid-ledger/contract';

/**
 * React Query hook for fetching current user's availability (ROK-182).
 * Transforms AvailabilityListResponseDto to RosterAvailabilityResponse format
 * for reuse with HeatmapGrid component.
 *
 * @param params - Optional date range filters (from, to)
 * @param enabled - Whether to enable the query (default: true)
 */
interface AvailabilityEntry {
    timeRange: { start: string; end: string };
    status: AvailabilityStatus;
    gameId?: number | null;
    sourceEventId?: number | null;
}

function transformToRosterResponse(data: AvailabilityEntry[]): RosterAvailabilityResponse {
    const slots = data.map((avail) => ({
        start: avail.timeRange.start,
        end: avail.timeRange.end,
        status: avail.status,
        gameId: avail.gameId ?? null,
        sourceEventId: avail.sourceEventId ?? null,
    }));

    const times = data.flatMap((a) => [
        new Date(a.timeRange.start).getTime(),
        new Date(a.timeRange.end).getTime(),
    ]);

    return {
        eventId: 0,
        timeRange: {
            start: new Date(Math.min(...times)).toISOString(),
            end: new Date(Math.max(...times)).toISOString(),
        },
        users: [{ id: 0, username: 'You', avatar: null, slots }],
    };
}

export function useMyAvailability(
    params?: AvailabilityQueryParams,
    enabled = true
) {
    return useQuery({
        queryKey: ['my-availability', params?.from, params?.to, params?.gameId],
        queryFn: async (): Promise<RosterAvailabilityResponse | null> => {
            const response = await getMyAvailability(params);
            if (!response.data || response.data.length === 0) return null;
            return transformToRosterResponse(response.data);
        },
        enabled: enabled && !!params?.from && !!params?.to,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
    });
}
