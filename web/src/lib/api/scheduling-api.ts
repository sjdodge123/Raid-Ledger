/**
 * Scheduling poll API client (ROK-965).
 * Functions for schedule poll page, slot suggestions, voting, and event creation.
 */
import type {
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
  RemindVotersResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';
import { weekStartQueryValue, weekTzOffsetMinutes } from '../week-start-query';

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

/**
 * Create an event from a schedule slot.
 *
 * @deprecated Use POST /events with matchId param instead (ROK-1121).
 * Endpoint retained for smoke-test compatibility — full removal tracked
 * separately.
 */
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

/** Cancel a scheduling poll (operator). Optional reason notifies voters. */
export async function cancelSchedulePoll(
  lineupId: number,
  matchId: number,
  reason?: string | null,
): Promise<{ ok: boolean }> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
  );
}

/**
 * Nudge members who haven't voted yet (ROK-1395, creator/operator only).
 * The server 429s inside the 1h per-match cooldown.
 */
export async function remindVoters(
  lineupId: number,
  matchId: number,
): Promise<RemindVotersResponseDto> {
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/remind`,
    { method: 'POST' },
  );
}

/**
 * Explicitly enrol members in a scheduling poll (ROK-1440). Idempotent —
 * re-adding an existing member is a server-side no-op.
 */
export async function addPollMembers(
  lineupId: number,
  matchId: number,
  userIds: number[],
): Promise<{ added: number; memberCount: number }> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  });
}

/**
 * Fetch heatmap availability data for a match.
 *
 * ROK-1570: the aggregate subtracts each member's signups and absences for a
 * DATED week, and the server defaults to the current one — so a grid paged
 * forward MUST name the week it is painting. `weekStart` is the grid's local
 * Sunday; `weekStartQueryValue` converts it to that calendar date at 00:00Z
 * (a raw `toISOString()` from a UTC+N viewer would name the previous week).
 *
 * `tzOffset` is that week's `Date.getTimezoneOffset()` (the same convention
 * `GET /users/me/game-time` uses), so the server keys members' busy hours in
 * the viewer's wall clock — the axis the grid actually draws. Omitting it
 * makes the server key in UTC, which is only right for a UTC viewer.
 */
export async function getMatchAvailability(
  lineupId: number,
  matchId: number,
  weekStart?: Date,
): Promise<AggregateGameTimeResponse> {
  const query = weekStart
    ? `?${new URLSearchParams({
        weekStart: weekStartQueryValue(weekStart),
        tzOffset: String(weekTzOffsetMinutes(weekStart)),
      }).toString()}`
    : '';
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/availability${query}`,
  );
}

/** Fetch scheduling banner for the events page (ROK-1235). */
export async function getSchedulingBanner(): Promise<SchedulingBannerDto | null> {
  return fetchApi('/scheduling/banner');
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
