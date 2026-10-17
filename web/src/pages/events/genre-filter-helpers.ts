import type { EventResponseDto, GameRegistryDto } from '@raid-ledger/contract';
import { GENRE_FILTERS } from '../games/games-constants';

/** A genre option for the filter dropdown */
export interface GenreOption {
    key: string;
    label: string;
}

/**
 * Build the list of genre options that are relevant for the given games.
 * Only includes genres that at least one game matches.
 * Sorted alphabetically by label.
 */
export function buildGenreOptions(games: GameRegistryDto[]): GenreOption[] {
    const matched = GENRE_FILTERS.filter((filter) =>
        games.some((g) => g.genres.length > 0 && filter.match(g.genres)),
    );
    return matched
        .map((f) => ({ key: f.key, label: f.label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Filter events by genre key. Returns all events when genreKey is falsy.
 * Builds an internal lookup from registryGames to match event game IDs.
 */
export function filterEventsByGenre(
    events: EventResponseDto[],
    registryGames: GameRegistryDto[],
    genreKey: string | undefined,
): EventResponseDto[] {
    if (!genreKey) return events;

    const filter = GENRE_FILTERS.find((f) => f.key === genreKey);
    if (!filter) return events;

    const genreGameIds = new Set(
        registryGames
            .filter((g) => g.genres.length > 0 && filter.match(g.genres))
            .map((g) => g.id),
    );

    return events.filter((e) => e.game != null && genreGameIds.has(e.game.id));
}
