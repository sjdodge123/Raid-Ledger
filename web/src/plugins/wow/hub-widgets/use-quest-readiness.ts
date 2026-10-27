/**
 * ROK-1924 — roster-wide dungeon-quest readiness for one Forever event
 * (ROK-1906 `GET /plugins/wow-classic/events/:eventId/quest-readiness`). The
 * endpoint is member-gated (403) and Forever-only (404); the widget renders
 * either as a quiet "not available" line, so this never retries.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { EventQuestReadinessSchema, type EventQuestReadinessDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

/** Query key — ends in the viewer scope because the read is audience-gated (ROK-1314). */
export function questReadinessKey(eventId: number, viewer: unknown): unknown[] {
    return ['plugins', 'wow', 'events', eventId, 'quest-readiness', viewer];
}

/** Every signup's state on the event's dungeon quests. */
export function useQuestReadiness(eventId: number): UseQueryResult<EventQuestReadinessDto, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: questReadinessKey(eventId, viewer),
        queryFn: () => fetchApi(`/plugins/wow-classic/events/${eventId}/quest-readiness`, {}, EventQuestReadinessSchema),
        enabled: eventId > 0,
        staleTime: STALE_MS,
        retry: false,
    });
}
