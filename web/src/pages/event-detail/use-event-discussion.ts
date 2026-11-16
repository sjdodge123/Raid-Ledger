/**
 * ROK-2226 — the event page's discussion card data: `GET /events/:id/discussion`
 * (parsed by the contract schema). Keyed per viewer, because `can` and
 * `latestReplies` depend on who is asking (signed up, member, visitor).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    EventDiscussionSchema,
    type EventDiscussion,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';
import { useViewerCacheScope } from '../../hooks/use-auth';

/** Invalidation prefix for one event's discussion summary. */
export function eventDiscussionKey(eventId: number): readonly unknown[] {
    return ['events', eventId, 'discussion'] as const;
}

/** The card summary: `none`, or the thread ids, reply count, ≤3 newest replies, lock and `can`. */
export function fetchEventDiscussion(
    eventId: number,
): Promise<EventDiscussion> {
    return fetchApi(`/events/${eventId}/discussion`, {}, EventDiscussionSchema);
}

/** The summary query; `enabled` false (logged out, untagged, hidden hub) never fetches. */
export function useEventDiscussion(
    eventId: number,
    enabled: boolean,
): UseQueryResult<EventDiscussion, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...eventDiscussionKey(eventId), viewer],
        queryFn: () => fetchEventDiscussion(eventId),
        enabled: enabled && eventId > 0,
        retry: false,
        staleTime: 30_000,
    });
}
