/** Slug-to-variant mapping for all WoW game entries. */
const SLUG_VARIANT_MAP: Record<string, string> = {
    'world-of-warcraft': 'retail',
    'world-of-warcraft-classic': 'classic_era',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition': 'classic_anniversary',
    'world-of-warcraft-burning-crusade-classic': 'classic',
    'world-of-warcraft-wrath-of-the-lich-king': 'classic',
};

/** All recognized WoW game slugs (retail + all classic variants). */
export const WOW_SLUGS: ReadonlySet<string> = new Set(Object.keys(SLUG_VARIANT_MAP));

/** Check if a game slug belongs to any WoW game entry. */
export function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug);
}

/**
 * Map game slug to WoW game variant for Blizzard API.
 * Returns null for non-WoW slugs.
 */
export function getWowVariant(slug: string): string | null {
    return SLUG_VARIANT_MAP[slug] ?? null;
}

/** Map event type slug to content category for instance browsing */
export function getContentType(slug: string): 'dungeon' | 'raid' | null {
    if (/raid/.test(slug)) return 'raid';
    if (/dungeon|mythic-plus/.test(slug)) return 'dungeon';
    return null;
}
