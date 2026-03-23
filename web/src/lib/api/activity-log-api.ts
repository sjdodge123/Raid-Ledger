/**
 * Activity Log API client (ROK-930).
 */
import type { ActivityTimelineResponseDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch activity timeline for a lineup. */
export async function getLineupActivity(
  lineupId: number,
): Promise<ActivityTimelineResponseDto> {
  return fetchApi(`/lineups/${lineupId}/activity`);
}

/** Fetch activity timeline for an event. */
export async function getEventActivity(
  eventId: number,
): Promise<ActivityTimelineResponseDto> {
  return fetchApi(`/events/${eventId}/activity`);
}
