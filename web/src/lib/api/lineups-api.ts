/**
 * Lineups API client (ROK-934).
 * Functions for lineup data fetching and game nomination.
 */
import type {
  LineupDetailResponseDto,
  LineupBannerResponseDto,
  LineupSummaryResponseDto,
  CommonGroundResponseDto,
  NominateGameDto,
  AbortLineupDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Query parameters for the Common Ground endpoint. */
export interface CommonGroundParams {
  minOwners?: number;
  maxPlayers?: number;
  genre?: string;
  search?: string;
  limit?: number;
  /** Explicit lineup to score against (ROK-1065). */
  lineupId?: number;
}

/**
 * Fetch every currently active lineup (ROK-1065).
 * Returns an array ordered newest-first. Was singular pre-ROK-1065.
 */
export async function getActiveLineups(): Promise<
  LineupSummaryResponseDto[]
> {
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
  if (params.search) search.set('search', params.search);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.lineupId != null) search.set('lineupId', String(params.lineupId));

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

/** Fetch the lightweight banner data for the Games page hero. */
export async function getLineupBanner(): Promise<LineupBannerResponseDto | null> {
  return fetchApi('/lineups/banner');
}

/** Fetch full lineup detail by ID. */
export async function getLineupById(id: number): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${id}`);
}

/** Remove a nomination from a lineup. */
export async function removeNomination(lineupId: number, gameId: number): Promise<void> {
  return fetchApi(`/lineups/${lineupId}/nominations/${gameId}`, { method: 'DELETE' });
}

/** Parameters for creating a lineup. */
export interface CreateLineupParams {
  /** Operator-authored title (required, 1-100 chars, ROK-1063). */
  title: string;
  /** Optional markdown description (<=500 chars, ROK-1063). */
  description?: string | null;
  targetDate?: string | null;
  buildingDurationHours?: number;
  votingDurationHours?: number;
  decidedDurationHours?: number;
  matchThreshold?: number;
  votesPerPlayer?: number;
  defaultTiebreakerMode?: 'bracket' | 'veto' | null;
  /** Optional per-lineup Discord channel override (ROK-1064). */
  channelOverrideId?: string | null;
  /** Lineup visibility — 'public' (default) or 'private' (ROK-1065). */
  visibility?: 'public' | 'private';
  /**
   * Explicit invitees when visibility === 'private' (ROK-1065).
   * Server enforces that private lineups carry at least one invitee.
   */
  inviteeUserIds?: number[];
}

/** Create a new lineup with optional duration params. */
export async function createLineup(
  params: CreateLineupParams,
): Promise<LineupDetailResponseDto> {
  return fetchApi('/lineups', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** Parameters for updating lineup metadata (ROK-1063). */
export interface UpdateLineupMetadataParams {
  title?: string;
  description?: string | null;
}

/** Update a lineup's title and/or description (ROK-1063). */
export async function updateLineupMetadata(
  lineupId: number,
  body: UpdateLineupMetadataParams,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Toggle a vote on a nominated game (ROK-936). */
export async function toggleVote(
  lineupId: number,
  gameId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ gameId }),
  });
}

/** Transition a lineup to a new status. */
export async function transitionLineupStatus(
  lineupId: number,
  body: { status: string; decidedGameId?: number | null },
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Add one or more invitees to a private lineup (ROK-1065).
 * Returns the refreshed lineup detail so the UI can update the roster
 * inline without a separate refetch.
 */
export async function addLineupInvitees(
  lineupId: number,
  userIds: number[],
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/invitees`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  });
}

/** Remove a single invitee from a private lineup (ROK-1065). */
export async function removeLineupInvitee(
  lineupId: number,
  userId: number,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/invitees/${userId}`, {
    method: 'DELETE',
  });
}

/**
 * Abort a lineup (ROK-1062). Admin/operator only; force-archives the
 * lineup with an optional reason recorded in activity log + Discord embed.
 */
export async function abortLineup(
  lineupId: number,
  body: AbortLineupDto,
): Promise<LineupDetailResponseDto> {
  return fetchApi(`/lineups/${lineupId}/abort`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
