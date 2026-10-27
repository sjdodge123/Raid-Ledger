/**
 * ROK-1942 — MSW fixtures for the hub Gallery list route. Not in the default
 * handler list: specs `server.use()` them. The list handler mirrors the API's
 * filter (`kind=screenshot` also matches `image` and `upload`) and its `kinds` (present
 * kinds, ignoring the filter, in `HUB_MEDIA_KINDS` order).
 */
import { http, HttpResponse } from 'msw';
import { HUB_MEDIA_KINDS, type HubMediaItem, type HubMediaKind, type HubMediaListResponse } from '@raid-ledger/contract';

export const HUB_MEDIA_LIST_URL = 'http://localhost:3000/hubs/:guildId/media';
export const HUB_MEDIA_FILE_URL = 'http://localhost:3000/hubs/:guildId/media/:id/:variant';

export function hubMediaItem(id: number, kind: HubMediaKind, over: Partial<HubMediaItem> = {}): HubMediaItem {
    return {
        id, kind,
        authorName: `Player${id}`,
        caption: null,
        capturedAt: new Date(Date.now() - id * 3_600_000).toISOString(),
        width: 1920, height: 1080,
        thumbPath: `/hubs/5/media/${id}/thumb`,
        fullPath: `/hubs/5/media/${id}/full`,
        source: { type: 'discord', label: 'Discord' },
        link: null,
        hidden: false,
        canRemove: false,
        ...over,
    };
}

function matchesKind(item: HubMediaItem, kind: string | null): boolean {
    if (kind === null) return true;
    if (kind === 'screenshot') return item.kind === 'screenshot' || item.kind === 'image' || item.kind === 'upload';
    return item.kind === kind;
}

/** Serves `items` (newest first) through the route's filter; `status` ≠ 200 → the hub-not-found body. */
export function hubMediaListHandler(items: HubMediaItem[], status = 200) {
    return http.get(HUB_MEDIA_LIST_URL, ({ request }) => {
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: 'Guild not found' }, { status });
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get('limit') ?? '24');
        const matching = items.filter((i) => matchesKind(i, url.searchParams.get('kind')));
        const body: HubMediaListResponse = {
            items: matching.slice(0, limit),
            nextCursor: matching.length > limit ? 'next' : null,
            total: matching.length,
            kinds: HUB_MEDIA_KINDS.filter((k) => items.some((i) => i.kind === k)),
        };
        return HttpResponse.json(body);
    });
}

/** The bytes route — a tiny webp-typed body (jsdom has no createObjectURL, so tiles keep their fallback). */
export const hubMediaFileHandler = http.get(HUB_MEDIA_FILE_URL, () =>
    new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }));

/** ROK-1965 — `POST /hubs/:guildId/media`: `status` 201 / 200 return `item`; anything else the `{statusCode, code, message}` body. */
export function hubMediaUploadHandler(item: HubMediaItem, status = 201, code?: string) {
    return http.post(HUB_MEDIA_LIST_URL, () => (status === 200 || status === 201
        ? HttpResponse.json(item, { status })
        : HttpResponse.json({ statusCode: status, ...(code !== undefined ? { code } : {}), message: 'Upload rejected' }, { status })));
}
