/**
 * Lineup submit API client (ROK-1296, U4 SubmitBar).
 *
 * Three POST endpoints — all idempotent re-stampers, all empty bodies.
 * Mirrors `lineups-api.ts::nominateGame` / `::toggleVote` shape so the
 * TanStack hooks at `use-lineup-submit.ts` look familiar to readers of
 * `use-lineups.ts`.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Submit nominations for the authed user (AC2a). */
export async function submitNominations(
  lineupId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/submit-nominations`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Submit votes for the authed user (AC2b). */
export async function submitVotes(
  lineupId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/submit-votes`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Submit scheduling for ONE match-member row (AC2c). */
export async function submitScheduling(
  lineupId: number,
  matchId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/matches/${matchId}/submit-scheduling`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
