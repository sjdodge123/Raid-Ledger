/**
 * Standalone scheduling poll API client (ROK-977).
 * POST /scheduling-polls — create a standalone scheduling poll.
 */
import type {
  ActiveStandalonePollDto,
  CreateSchedulingPollDto,
  SchedulingPollResponseDto,
  PollSharePreviewDto,
  PollShareJoinResponseDto,
  PollShareTokenResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';
import { encodePathSegment } from './path-segment';

/** Fetch active standalone scheduling polls. */
export async function getActiveStandalonePolls(): Promise<ActiveStandalonePollDto[]> {
  return fetchApi('/scheduling-polls/active');
}

/** Complete a standalone poll (archive after reschedule/event creation).
 *  When eventId is provided, auto-signup slot voters for that event (ROK-1031). */
export async function completeStandalonePoll(
  matchId: number,
  eventId?: number,
  startTime?: string,
): Promise<void> {
  const body = eventId ? { eventId, startTime } : undefined;
  await fetchApi(`/scheduling-polls/${matchId}/complete`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** Create a standalone scheduling poll. */
export async function createSchedulingPoll(
  dto: CreateSchedulingPollDto,
): Promise<SchedulingPollResponseDto> {
  return fetchApi('/scheduling-polls', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** ROK-1750: public preview of a private poll's share link (no auth). */
export async function getPollSharePreview(token: string): Promise<PollSharePreviewDto> {
  return fetchApi(`/scheduling-polls/share/${encodePathSegment(token)}`);
}

/** ROK-1750: redeem a share link — the viewer becomes an invitee (+ member while open). */
export async function joinPollShare(token: string): Promise<PollShareJoinResponseDto> {
  return fetchApi(`/scheduling-polls/share/${encodePathSegment(token)}/join`, { method: 'POST' });
}

/** ROK-1750: rotate a private poll's share token (creator / admin only). */
export async function resetPollShareToken(matchId: number): Promise<PollShareTokenResponseDto> {
  return fetchApi(`/scheduling-polls/${matchId}/share-token/reset`, { method: 'POST' });
}
