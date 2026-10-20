/**
 * ROK-1868 — the `?post=<id>#posts` deep-link helpers. Their own module because
 * the hub shell (`hub-page.tsx`) reads the id on every load: importing it from
 * `hub-post.helpers` pulled the composer/relay helpers (and their contract
 * imports) into the capped `hub-page` route chunk. Keep this file tiny.
 */

/** `?post=<id>` from a location search string; null unless a positive integer. */
export function postIdFromSearch(search: string): number | null {
    const raw = new URLSearchParams(search).get('post');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return id > 0 ? id : null;
}

/** `${origin}/guilds/<id>?post=<postId>#posts` — the same shape the server links to. */
export function postDeepLink(guildId: number, postId: number): string {
    return `${window.location.origin}/guilds/${guildId}?post=${postId}#posts`;
}
