/** ROK-1813 (D10) — helpers for the public recruiting card settings section (split out for fast refresh). */

/** The absolute `/p/guild/:slug` address a Leader pastes into Discord or a forum. */
export function publicCardUrl(slug: string, origin: string = window.location.origin): string {
    return `${origin}/p/guild/${slug}`;
}
