import type {
    GameSearchResponseDto,
    GameRegistryListResponseDto,
    EventTypesResponseDto,
    ActivityPeriod,
    GameActivityResponseDto,
    GameNowPlayingResponseDto,
} from '@raid-ledger/contract';
import { GameSearchResponseSchema } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Search for games via IGDB */
export async function searchGames(
    query: string,
    signal?: AbortSignal,
): Promise<GameSearchResponseDto> {
    const params = new URLSearchParams({ q: query });
    return fetchApi(
        `/games/search?${params}`,
        { signal },
        GameSearchResponseSchema,
    );
}

/**
 * Fetch all configured games (enabled, with config columns).
 * ROK-400: Uses /games/configured.
 */
export async function fetchGameRegistry(): Promise<GameRegistryListResponseDto> {
    return fetchApi('/games/configured');
}

/** Fetch event types for a specific game */
export async function getGameEventTypes(
    gameId: number,
): Promise<EventTypesResponseDto> {
    return fetchApi(`/games/${gameId}/event-types`);
}

/** Fetch community activity for a game (ROK-443) */
export async function getGameActivity(
    gameId: number,
    period: ActivityPeriod,
): Promise<GameActivityResponseDto> {
    return fetchApi(`/games/${gameId}/activity?period=${period}`);
}

/** Fetch users currently playing a game (ROK-443) */
export async function getGameNowPlaying(
    gameId: number,
): Promise<GameNowPlayingResponseDto> {
    return fetchApi(`/games/${gameId}/now-playing`);
}
