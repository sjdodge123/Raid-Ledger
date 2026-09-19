/**
 * ROK-1159: responsive `srcset` for IGDB cover art.
 *
 * IGDB's image CDN encodes the rendition in a path segment:
 * `https://images.igdb.com/igdb/image/upload/t_<size>/<hash>.jpg`. Swapping
 * `t_cover_big` for `t_cover_small` returns the same artwork at a smaller
 * intrinsic size, so a 40px thumbnail no longer has to download the 264px
 * rendition the API stores (`api/src/igdb/igdb.constants.ts::COVER_URL_BASE`).
 *
 * Covers are NOT all IGDB. `steam-itad-discovery.helpers.ts:54` falls back to
 * `itadGame.assets.boxart`, whose host has no documented rendition API — there
 * is no size token to rewrite, and guessing one would 404. Every helper here
 * therefore returns `null` for a non-IGDB URL and callers omit `srcSet`
 * entirely rather than emitting a set that resolves to broken images.
 */

/** IGDB renditions used for cover art, with their true intrinsic widths. */
const COVER_RENDITIONS: ReadonlyArray<{ token: string; width: number }> = [
    { token: 't_cover_small', width: 90 },
    { token: 't_cover_big', width: 264 },
    { token: 't_cover_big_2x', width: 528 },
];

/**
 * Intrinsic pixel size of IGDB's `t_cover_big` rendition. Used as the default
 * `width`/`height` pair so the browser can reserve the right aspect-ratio box
 * before the bytes land (this is what actually prevents layout shift — CSS
 * still controls the rendered size).
 */
export const COVER_INTRINSIC = { width: 264, height: 374 } as const;

/** Matches the rendition segment of an IGDB image URL. */
const IGDB_RENDITION = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+(\/.+)$/i;

/**
 * True when `url` is an IGDB image URL whose rendition segment can be rewritten.
 * A bare `images.igdb.com` URL with no `t_*` segment does NOT qualify.
 */
export function isIgdbImageUrl(url: string | null | undefined): boolean {
    return typeof url === 'string' && IGDB_RENDITION.test(url);
}

/**
 * A `srcset` offering the cover renditions IGDB can serve for `url`, or `null`
 * when the URL is not a rewritable IGDB image (ITAD boxart, Steam, uploads).
 */
export function coverSrcSet(url: string | null | undefined): string | null {
    if (typeof url !== 'string') return null;
    const match = IGDB_RENDITION.exec(url);
    if (!match) return null;
    const [, prefix, suffix] = match;
    return COVER_RENDITIONS.map((r) => `${prefix}${r.token}${suffix} ${r.width}w`).join(', ');
}

/**
 * `srcSet`/`sizes` props for a cover `<img>`, spread-ready and empty for
 * non-IGDB URLs. `sizes` must describe the CSS width the cover paints at, so
 * callers pass their own (e.g. `'40px'` for a row thumb, a media query for a
 * responsive grid tile).
 */
export function coverSrcSetProps(
    url: string | null | undefined,
    sizes: string,
): { srcSet: string; sizes: string } | Record<string, never> {
    const srcSet = coverSrcSet(url);
    return srcSet ? { srcSet, sizes } : {};
}
