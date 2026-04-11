/**
 * Standalone scheduling poll API client (ROK-977).
 * POST /scheduling-polls — create a standalone scheduling poll.
 */
import type {
  ActiveStandalonePollDto,
  CreateSchedulingPollDto,
  SchedulingPollResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch active standalone scheduling polls. */
export async function getActiveStandalonePolls(): Promise<ActiveStandalonePollDto[]> {
  return fetchApi('/scheduling-polls/active');
}

/** Complete a standalone poll (archive after reschedule/event creation).
 *  When eventId is provided, auto-signup slot voters for that event (ROK-1031). */
export async function completeStandalonePoll(matchId: number, eventId?: number): Promise<void> {
  await fetchApi(`/scheduling-polls/${matchId}/complete`, {
    method: 'POST',
    body: eventId ? JSON.stringify({ eventId }) : undefined,
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
