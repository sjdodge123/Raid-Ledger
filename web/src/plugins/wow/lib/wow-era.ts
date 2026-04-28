/**
 * Map a game slug to a WoW era so other libs (max-skill, profession
 * availability) can derive variant-specific behavior from a single source.
 *
 * Anything we don't recognise falls back to `retail` since most modern
 * variants share the live WoW Profile API namespace and the same caps.
 */

export type WowEra =
    | 'vanilla'
    | 'bc'
    | 'wrath'
    | 'cataclysm'
    | 'mop'
    | 'retail';

const ERA_BY_SLUG: Record<string, WowEra> = {
    'world-of-warcraft-classic': 'vanilla',
    'world-of-warcraft-classic-season-of-discovery': 'vanilla',
    'world-of-warcraft-burning-crusade-classic': 'bc',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition': 'bc',
    'world-of-warcraft-wrath-of-the-lich-king-classic': 'wrath',
    'world-of-warcraft-cataclysm-classic': 'cataclysm',
    'world-of-warcraft-mists-of-pandaria-classic': 'mop',
};

export function getWowEra(gameSlug: string | null | undefined): WowEra {
    if (!gameSlug) return 'retail';
    return ERA_BY_SLUG[gameSlug] ?? 'retail';
}
