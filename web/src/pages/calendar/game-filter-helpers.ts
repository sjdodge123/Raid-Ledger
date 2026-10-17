import type { GameInfo } from '../../stores/game-filter-store';

/** Game info extended with a liked flag for UI sectioning. */
export interface GameWithLiked extends GameInfo {
    liked: boolean;
}

/**
 * Sort games with liked games first (alphabetical), then other games (alphabetical).
 * Each game is annotated with a `liked` flag based on likedSlugs membership.
 */
export function sortGamesWithLikedFirst(
    games: GameInfo[],
    likedSlugs: Set<string>,
): GameWithLiked[] {
    return games
        .map((g) => ({ ...g, liked: likedSlugs.has(g.slug) }))
        .sort((a, b) => {
            if (a.liked !== b.liked) return a.liked ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

/**
 * ROK-1662 — the calendar Filters badge: how many KNOWN games are filtered out.
 * Slugs in `selectedGames` that are not (yet) known do not count, so the badge
 * never shows while every known game is visible and never hides while any is
 * filtered out.
 */
export function countHiddenGames(games: GameInfo[], selectedGames: Set<string>): number {
    let hidden = 0;
    for (const g of games) if (!selectedGames.has(g.slug)) hidden += 1;
    return hidden;
}

/** Case-insensitive name match for the filter's game search; a blank query keeps every game. */
export function filterGamesByName<T extends GameInfo>(games: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
}
