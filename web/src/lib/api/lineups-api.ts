/**
 * Lineups API client (ROK-934).
 * Functions for lineup data fetching and game nomination.
 */
import type {
  LineupDetailResponseDto,
  CommonGroundResponseDto,
  NominateGameDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Query parameters for the Common Ground endpoint. */
export interface CommonGroundParams {
  minOwners?: number;
  maxPlayers?: number;
  genre?: string;
  limit?: number;
}

/** Fetch the currently active lineup. */
export async function getActiveLineup(): Promise<LineupDetailResponseDto> {
  return fetchApi('/lineups/active');
}

/** Fetch Common Ground games with filters. */
export async function getCommonGround(
  params: CommonGroundParams = {},
): Promise<CommonGroundResponseDto> {
  const search = new URLSearchParams();
  if (params.minOwners != null) search.set('minOwners', String(params.minOwners));
  if (params.maxPlayers != null) search.set('maxPlayers', String(params.maxPlayers));
  if (params.genre) search.set('genre', params.genre);
  if (params.limit != null) search.set('limit', String(params.limit));

  const qs = search.toString();
  return fetchApi(`/lineups/common-ground${qs ? `?${qs}` : ''}`);
}

/** Nominate a game into a lineup. */
export async function nominateGame(
  lineupId: number,
  body: NominateGameDto,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/nominate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
