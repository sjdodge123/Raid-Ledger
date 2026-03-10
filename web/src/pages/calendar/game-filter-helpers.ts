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
