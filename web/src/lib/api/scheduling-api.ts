/**
 * Scheduling poll API client (ROK-965).
 * Functions for schedule poll page, slot suggestions, voting, and event creation.
 */
import type {
  SchedulePollPageResponseDto,
  SchedulingBannerDto,
  OtherPollsResponseDto,
  AggregateGameTimeResponse,
  RallyNonVotersRequestDto,
  RallyNonVotersResponseDto,
  RemindVotersResponseDto,
  ScheduleVoteStance,
  ScheduleVoteSource,
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

/**
 * Suggest a new time slot.
 *
 * ROK-1550: the server auto-votes for the new slot on the suggester's behalf,
 * so `source` is the auto-vote's provenance — `'discord'` only when the poll
 * page was opened on the card's link. Same closed enum as the vote body: an
 * unknown value is a 400, so callers map through `voteSourceFromParam`.
 */
export async function suggestSlot(
  lineupId: number,
  matchId: number,
  proposedTime: string,
  source: ScheduleVoteSource = 'web',
): Promise<{ id: number }> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}/suggest`, {
    method: 'POST',
    body: JSON.stringify({ proposedTime, source }),
  });
}

/**
 * Toggle a vote on a schedule slot.
 *
 * ROK-1617: `stance` says WHICH answer is being pressed. Pressing the one
 * already on record clears it, so a mis-tapped "doesn't work" is one more tap
 * from undone. Defaulted to `'yes'` — the server defaults it too, so an older
 * client's body stays valid.
 *
 * ROK-1550: `source` records WHERE the visit came from — `'discord'` only
 * when the viewer arrived on the poll card's link. The server rejects any
 * value outside its enum, so callers map through `voteSourceFromParam`
 * rather than passing a raw URL value.
 */
export async function toggleScheduleVote(
  lineupId: number,
  matchId: number,
  slotId: number,
  stance: ScheduleVoteStance = 'yes',
  source: ScheduleVoteSource = 'web',
): Promise<{ voted: boolean; stance: ScheduleVoteStance | null }> {
  return fetchApi(`/lineups/${lineupId}/schedule/${matchId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ slotId, stance, source }),
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
 * Rally the poll members who still owe a vote (ROK-1618, creator/operator).
 *
 * Wider audience than {@link remindVoters}: the recurring nudge's own "no
 * stance on any future slot" set, sharing its 24h per-member dedup. The server
 * 429s inside the 6h per-poll cooldown and 403s a plain member; both carry a
 * human-readable `message` the UI toasts verbatim.
 */
export async function rallyNonVoters(
  lineupId: number,
  matchId: number,
  slotId?: number,
): Promise<RallyNonVotersResponseDto> {
  // ROK-1635: the `slotId` key is omitted when no slot is named, so the server
  // takes its legacy "rally the leading time" path. Not byte-identical to the
  // old bodiless request — the body goes from absent to `{}` — but equivalent
  // against the route's `@Body()` + optional-field parse.
  const body: RallyNonVotersRequestDto = slotId === undefined ? {} : { slotId };
  return fetchApi(
    `/lineups/${lineupId}/schedule/${matchId}/rally`,
    { method: 'POST', body: JSON.stringify(body) },
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
