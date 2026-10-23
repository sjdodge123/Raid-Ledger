/**
 * ROK-1891 — the hub page route, one place. The frontend route is `/hubs/:id`
 * for every hub kind; the API keeps its `/guilds/...` paths.
 */

/** React Router matches `/guilds/:id` case-insensitively, so the rewrite must too (Codex P2). */
const LEGACY_PREFIX = /^\/guilds\//i;

/** The hub page path prefix (`/hubs/<id>`). */
export const HUB_PAGE_PREFIX = '/hubs/';

/** A legacy `/guilds/<id>…` pathname rewritten under `/hubs/`; anything else unchanged. */
export function hubPathFromLegacy(pathname: string): string {
    return pathname.replace(LEGACY_PREFIX, HUB_PAGE_PREFIX);
}
