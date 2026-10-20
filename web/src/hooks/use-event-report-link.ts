/**
 * ROK-1725 — set or clear an event's report link from the detail-page "Logs"
 * card. The PATCH returns the full updated event, so the detail bundle the page
 * reads (`['events', eventId, 'detail']`, `useEventDetail`) is patched in place
 * rather than refetched.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ViewerEventDetailDto } from '../lib/api/viewer-event-schemas';
import { updateEventReportLink } from '../lib/api/events-api';

export function useUpdateEventReportLink(eventId: number) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (reportUrl: string | null) => updateEventReportLink(eventId, reportUrl),
        onSuccess: (updated) => {
            queryClient.setQueryData<ViewerEventDetailDto>(['events', eventId, 'detail'], (old) =>
                old ? { ...old, event: { ...old.event, reportUrl: updated.reportUrl ?? null } } : old,
            );
        },
    });
}
