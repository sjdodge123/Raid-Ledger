/**
 * Lineup submit API client (ROK-1296, U4 SubmitBar).
 *
 * One POST endpoint, `submit-votes` — an idempotent re-stamper with an
 * empty body. Mirrors `lineups-api.ts::nominateGame` / `::toggleVote`
 * shape so the TanStack hook at `use-lineup-submit.ts` looks familiar to
 * readers of `use-lineups.ts`.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Submit votes for the authed user (AC2b). */
export async function submitVotes(
  lineupId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/submit-votes`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
