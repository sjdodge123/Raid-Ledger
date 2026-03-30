/**
 * Scheduling poll API client (ROK-965).
 * Functions for schedule poll page, slot suggestions, voting, and event creation.
 */
import type {
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  RosterAvailabilityResponse,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch the full scheduling poll page data. */
export async function getSchedulePoll(
  lineupId: number,
  matchId: number,
): Promise<SchedulePollPageResponseDto> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}`);
}

/** Suggest a new time slot. */
export async function suggestSlot(
  lineupId: number,
  matchId: number,
  proposedTime: string,
): Promise<{ id: number }> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}/suggest`, {
    method: 'POST',
    body: JSON.stringify({ proposedTime }),
  });
}

/** Toggle a vote on a schedule slot. */
export async function toggleScheduleVote(
  lineupId: number,
  matchId: number,
  slotId: number,
): Promise<{ voted: boolean }> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ slotId }),
  });
}

/** Create an event from a schedule slot. */
export async function createEventFromSlot(
  lineupId: number,
  matchId: number,
  slotId: number,
  recurring?: boolean,
): Promise<{ eventId: number }> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/create-event`,
    { method: 'POST', body: JSON.stringify({ slotId, recurring }) },
  );
}

/** Retract all votes for a match. */
export async function retractAllVotes(
  lineupId: number,
  matchId: number,
): Promise<void> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/votes`,
    { method: 'DELETE' },
  );
}

/** Fetch heatmap availability data for a match. */
export async function getMatchAvailability(
  lineupId: number,
  matchId: number,
): Promise<RosterAvailabilityResponse> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/availability`,
  );
}

/** Fetch scheduling banner for the events page. */
export async function getSchedulingBanner(): Promise<SchedulingBannerDto | null> {
  return fetchApi('/lineups/scheduling-banner');
}

/** Fetch other scheduling polls for the current user. */
export async function getOtherPolls(
  lineupId: number,
  matchId: number,
): Promise<OtherPollsResponseDto> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/other-polls`,
  );
}
