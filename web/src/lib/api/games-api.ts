import type {
    GameSearchResponseDto,
    GameRegistryListResponseDto,
    EventTypesResponseDto,
    ActivityPeriod,
    GameActivityResponseDto,
    GameNowPlayingResponseDto,
    ItadGamePricingDto,
    ItadBatchPricingResponseDto,
    IgdbGameDto,
    GameTasteProfileResponseDto,
} from '@raid-ledger/contract';
import { GameSearchResponseSchema, IgdbGameSchema } from '@raid-ledger/contract';
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

/** Fetch ITAD pricing data for a game (ROK-419) */
export async function getGamePricing(
    gameId: number,
): Promise<{ data: ItadGamePricingDto | null }> {
    return fetchApi(`/games/${gameId}/pricing`);
}

/** Fetch ITAD pricing data for multiple games in one request (ROK-800) */
export async function getGamePricingBatch(
    gameIds: number[],
): Promise<ItadBatchPricingResponseDto> {
    const params = new URLSearchParams({ ids: gameIds.join(',') });
    return fetchApi(`/games/pricing/batch?${params}`);
}

/** Look up a game by Steam App ID (ROK-945). */
export async function getGameBySteamAppId(
    steamAppId: number,
): Promise<IgdbGameDto> {
    return fetchApi(`/games/by-steam-id/${steamAppId}`, {}, IgdbGameSchema);
}

/** Fetch the game taste profile (7-axis vector + pool dimensions, ROK-1082) */
export async function getGameTasteProfile(
    gameId: number,
): Promise<GameTasteProfileResponseDto> {
    return fetchApi(`/games/${gameId}/taste-profile`);
}
