/** Map registry slug to WoW game variant for Blizzard API */
export function getWowVariant(slug: string): string | null {
    if (slug === 'wow') return 'retail';
    if (slug === 'wow-classic') return 'classic';
    return null;
}

/** Map event type slug to content category for instance browsing */
export function getContentType(slug: string): 'dungeon' | 'raid' | null {
    if (/raid/.test(slug)) return 'raid';
    if (/dungeon|mythic-plus/.test(slug)) return 'dungeon';
    return null;
}
