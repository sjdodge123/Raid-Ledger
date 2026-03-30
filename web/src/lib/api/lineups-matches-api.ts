/**
 * Lineups Matches API client (ROK-989).
 * Functions for fetching grouped matches, bandwagon join, and operator advance.
 */
import type {
  GroupedMatchesResponseDto,
  BandwagonJoinResponseDto,
  MatchDetailResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch grouped matches for a lineup's decided view. */
export async function getLineupMatches(
  lineupId: number,
): Promise<GroupedMatchesResponseDto> {
  return fetchApi(`/lineups/${lineupId}/matches`);
}

/** Bandwagon join: add the current user to a match group. */
export async function joinMatch(
  lineupId: number,
  matchId: number,
): Promise<BandwagonJoinResponseDto> {
  return fetchApi(`/lineups/${lineupId}/matches/${matchId}/join`, {
    method: 'POST',
  });
}

/** Operator advance: promote a match to the next tier. */
export async function advanceMatch(
  lineupId: number,
  matchId: number,
): Promise<MatchDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/matches/${matchId}/advance`, {
    method: 'POST',
  });
}
