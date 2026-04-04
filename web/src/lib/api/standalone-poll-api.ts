/**
 * Standalone scheduling poll API client (ROK-977).
 * POST /scheduling-polls — create a standalone scheduling poll.
 */
import type {
  CreateSchedulingPollDto,
  SchedulingPollResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Create a standalone scheduling poll. */
export async function createSchedulingPoll(
  dto: CreateSchedulingPollDto,
): Promise<SchedulingPollResponseDto> {
  return fetchApi('/scheduling-polls', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}
