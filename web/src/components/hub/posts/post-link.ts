/**
 * ROK-1868 — the `?post=<id>#posts` deep-link helpers. Their own module because
 * the hub shell (`hub-page.tsx`) reads the id on every load: importing it from
 * `hub-post.helpers` pulled the composer/relay helpers (and their contract
 * imports) into the capped `hub-page` route chunk. Keep this file tiny.
 */
import { HUB_PAGE_PREFIX } from '../../routing/hub-paths';

/** `?post=<id>` from a location search string; null unless a positive integer. */
export function postIdFromSearch(search: string): number | null {
    const raw = new URLSearchParams(search).get('post');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return id > 0 ? id : null;
}

/** `${origin}/hubs/<id>?post=<postId>#posts` (ROK-1891; the server's `/guilds/` links redirect here). */
export function postDeepLink(guildId: number, postId: number): string {
    return `${window.location.origin}${HUB_PAGE_PREFIX}${guildId}?post=${postId}#posts`;
}
