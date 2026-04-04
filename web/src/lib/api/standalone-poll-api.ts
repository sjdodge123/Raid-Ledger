/**
 * Standalone scheduling poll API client (ROK-977).
 * POST /scheduling-polls — create a standalone scheduling poll.
 */
import type {
  CreateSchedulingPollDto,
  SchedulingPollResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Active standalone poll shape from GET /scheduling-polls/active. */
export interface ActiveStandalonePoll {
  matchId: number;
  lineupId: number;
  gameName: string;
  gameCoverUrl: string | null;
  memberCount: number;
  slotCount: number;
}

/** Fetch active standalone scheduling polls. */
export async function getActiveStandalonePolls(): Promise<ActiveStandalonePoll[]> {
  return fetchApi('/scheduling-polls/active');
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
