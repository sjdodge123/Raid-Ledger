/**
 * Save-Data / slow-link check for GG <year> (ROK-2187 spec UX): when the
 * browser asks to save data or the link is slower than 4G, the story shows
 * stills only — no trailer player, no Ken Burns motion.
 */
const SLOW_LINKS: ReadonlySet<string> = new Set(['slow-2g', '2g', '3g']);

/** True under `navigator.connection.saveData` or an effectiveType below 4g. */
export function ggPrefersLowData(): boolean {
    const connection: unknown = Reflect.get(navigator, 'connection');
    if (typeof connection !== 'object' || connection === null) return false;
    if ('saveData' in connection && connection.saveData === true) return true;
    return 'effectiveType' in connection && typeof connection.effectiveType === 'string'
        && SLOW_LINKS.has(connection.effectiveType);
}
