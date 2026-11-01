/**
 * ROK-1926 — the "Ready for next run" read for one Forever event
 * (`GET /plugins/wow-classic/events/:eventId/raid-readiness`). Members, staff
 * and signups only (403) and Forever-only (404); the widget shows either as a
 * quiet line, so this never retries.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { EventRaidReadinessSchema, type EventRaidReadiness } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

/** Query key — ends in the viewer scope because the read is audience-gated (ROK-1314). */
export function raidReadinessKey(eventId: number, viewer: unknown): unknown[] {
    return ['plugins', 'wow', 'events', eventId, 'raid-readiness', viewer];
}

/** Every signup's level / quests / lockout / item-level check for the event. */
export function useRaidReadiness(eventId: number): UseQueryResult<EventRaidReadiness, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: raidReadinessKey(eventId, viewer),
        queryFn: () => fetchApi(`/plugins/wow-classic/events/${eventId}/raid-readiness`, {}, EventRaidReadinessSchema),
        enabled: eventId > 0,
        staleTime: STALE_MS,
        retry: false,
    });
}
