import type { UpdateEventDto, SeriesScope } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Update a series of events with scope selection (ROK-429). */
export async function updateSeries(
    eventId: number,
    scope: SeriesScope,
    data: UpdateEventDto,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}/series`, {
        method: 'PATCH',
        body: JSON.stringify({ scope, data }),
    });
}

/** Delete a series of events with scope selection (ROK-429). */
export async function deleteSeries(
    eventId: number,
    scope: SeriesScope,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}/series?scope=${scope}`, {
        method: 'DELETE',
    });
}

/** Cancel a series of events with scope selection (ROK-429). */
export async function cancelSeries(
    eventId: number,
    scope: SeriesScope,
    reason?: string,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}/series/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ scope, reason }),
    });
}
