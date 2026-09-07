/**
 * ROK-1482: image resource hints for calendar event cards.
 *
 * Each card paints its game cover as an inline CSS background-image (external
 * IGDB / ITAD URL) and its attendee avatars as `<img loading="lazy">` on the
 * Discord CDN. The browser only discovers those URLs at style-recalc time, one
 * card at a time, so covers pop in staggered. These helpers (a) warm the CDN
 * connections up-front and (b) kick every image the response will paint in one
 * go, so the cards resolve together.
 */
import type { EventResponseDto } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser } from './avatar';

/**
 * CDN origins the calendar cards draw from. Derived from the URL builders:
 * - `api/src/igdb/igdb.constants.ts::COVER_URL_BASE` → images.igdb.com
 * - `web/src/lib/avatar.ts::buildDiscordAvatarUrl` → cdn.discordapp.com
 * ITAD boxart fallbacks carry whatever host ITAD returns; those origins are
 * derived from the response at prefetch time instead (see `originOf`).
 */
export const IMAGE_CDN_ORIGINS: readonly string[] = [
    'https://images.igdb.com',
    'https://cdn.discordapp.com',
];

/** Upper bound on eagerly prefetched images per response. */
export const MAX_PREFETCH_IMAGES = 40;

/** Origin of an absolute http(s) URL, or null for relative / non-http URLs. */
export function originOf(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch {
        return null;
    }
}

function hasHint(head: HTMLHeadElement, rel: string, href: string): boolean {
    return Array.from(head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))
        .some((link) => link.getAttribute('href') === href);
}

/**
 * Append `preconnect` + `dns-prefetch` hints for each origin not already hinted.
 * No `crossorigin` attribute on purpose: CSS background images and plain `<img>`
 * fetch in no-cors mode, which only reuses a preconnect made without it.
 * Returns the origins that were added.
 */
export function ensureOriginHints(origins: Iterable<string>, doc: Document = document): string[] {
    const added: string[] = [];
    for (const origin of new Set(origins)) {
        if (hasHint(doc.head, 'preconnect', origin)) continue;
        for (const rel of ['preconnect', 'dns-prefetch'] as const) {
            const link = doc.createElement('link');
            link.rel = rel;
            link.href = origin;
            doc.head.appendChild(link);
        }
        added.push(origin);
    }
    return added;
}

/** Avatar URLs exactly as `AttendeeAvatars` will resolve them for this event. */
function avatarUrlsFor(event: EventResponseDto): string[] {
    const gameId = event.game?.id ?? undefined;
    return (event.signupsPreview ?? [])
        .map((signup) => resolveAvatar(toAvatarUser(signup), gameId).url)
        .filter((url): url is string => Boolean(url));
}

/** Unique image URLs the calendar cards will paint for these events, in card order, capped. */
export function collectEventImageUrls(events: ReadonlyArray<EventResponseDto>, cap = MAX_PREFETCH_IMAGES): string[] {
    const urls = new Set<string>();
    for (const event of events) {
        if (urls.size >= cap) break;
        const cover = event.game?.coverUrl;
        if (cover) urls.add(cover);
        for (const url of avatarUrlsFor(event)) {
            if (urls.size >= cap) break;
            urls.add(url);
        }
    }
    return Array.from(urls).slice(0, cap);
}

/**
 * Start a browser fetch for each URL not in `seen`, recording it there.
 * Returns the URLs that were newly kicked.
 */
export function prefetchImages(urls: Iterable<string>, seen: Set<string>): string[] {
    if (typeof Image === 'undefined') return [];
    const started: string[] = [];
    for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        const img = new Image();
        img.src = url;
        started.push(url);
    }
    return started;
}
