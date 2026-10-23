/**
 * ROK-1891 — the hub page route, one place. The frontend route is `/hubs/:id`
 * for every hub kind; the API keeps its `/guilds/...` paths.
 */

const LEGACY_PREFIX = '/guilds/';

/** The hub page path prefix (`/hubs/<id>`). */
export const HUB_PAGE_PREFIX = '/hubs/';

/** A legacy `/guilds/<id>…` pathname rewritten under `/hubs/`; anything else unchanged. */
export function hubPathFromLegacy(pathname: string): string {
    return pathname.startsWith(LEGACY_PREFIX)
        ? `${HUB_PAGE_PREFIX}${pathname.slice(LEGACY_PREFIX.length)}`
        : pathname;
}
