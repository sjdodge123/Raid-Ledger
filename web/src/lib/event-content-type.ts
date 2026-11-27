/**
 * Map an event-type slug to the content category an instance browser lists
 * (ROK-2359: core — event types are core; moved from the WoW plugin's utils).
 */
export function getContentType(slug: string): 'dungeon' | 'raid' | null {
    if (/raid/.test(slug)) return 'raid';
    if (/dungeon|mythic-plus/.test(slug)) return 'dungeon';
    return null;
}
