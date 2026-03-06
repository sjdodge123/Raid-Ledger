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
