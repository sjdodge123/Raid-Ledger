/**
 * React Query hook for activity timelines (ROK-930).
 */
import { useQuery } from '@tanstack/react-query';
import type { ActivityTimelineResponseDto } from '@raid-ledger/contract';
import { getEventActivity, getLineupActivity } from '../lib/api-client';

type EntityType = 'lineup' | 'event';

const fetchers: Record<EntityType, (id: number) => Promise<ActivityTimelineResponseDto>> = {
  lineup: getLineupActivity,
  event: getEventActivity,
};

export function useActivityTimeline(entityType: EntityType, entityId: number) {
  return useQuery<ActivityTimelineResponseDto>({
    queryKey: ['activity-timeline', entityType, entityId],
    queryFn: () => fetchers[entityType](entityId),
    staleTime: 30_000,
    enabled: entityId > 0,
  });
}
