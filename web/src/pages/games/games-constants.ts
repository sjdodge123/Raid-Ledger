/** Compound genre filter -- supports multi-genre matching (e.g. MMORPG = RPG + Online) */
export interface GenreFilterDef {
    key: string;
    label: string;
    match: (genres: number[]) => boolean;
}

/** Genre filter definitions for IGDB genre IDs */
export const GENRE_FILTERS: GenreFilterDef[] = [
    { key: 'rpg', label: 'RPG', match: (g) => g.includes(12) },
    { key: 'shooter', label: 'Shooter', match: (g) => g.includes(5) },
    { key: 'adventure', label: 'Adventure', match: (g) => g.includes(31) },
    { key: 'strategy', label: 'Strategy', match: (g) => g.includes(15) },
    { key: 'simulator', label: 'Simulator', match: (g) => g.includes(13) },
    { key: 'sport', label: 'Sport', match: (g) => g.includes(14) },
    { key: 'racing', label: 'Racing', match: (g) => g.includes(10) },
    { key: 'fighting', label: 'Fighting', match: (g) => g.includes(4) },
    { key: 'indie', label: 'Indie', match: (g) => g.includes(32) },
    { key: 'mmorpg', label: 'MMORPG', match: (g) => g.includes(12) && g.includes(36) },
    { key: 'moba', label: 'MOBA', match: (g) => g.includes(36) && !g.includes(12) },
];

/**
 * The one list of valid genre keys (ROK-1525). The chip row, the mobile sheet
 * and the `genres` URL sanitizer all read it, so none of them can disagree
 * about whether a key is real — an unknown key in a hand-edited or stale URL
 * has to be IGNORED, not rendered as a selection nothing can clear.
 */
const GENRE_FILTER_KEYS: ReadonlySet<string> = new Set(GENRE_FILTERS.map((g) => g.key));

/** True only for a key that `GENRE_FILTERS` actually defines. */
export function isGenreFilterKey(key: string | null | undefined): key is string {
    return typeof key === 'string' && GENRE_FILTER_KEYS.has(key);
}
