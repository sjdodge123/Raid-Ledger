/**
 * ROK-1942 — the hub Gallery read client: `GET /hubs/:guildId/media`, shape-locked.
 * Schema-bound, so the eager probe / header action import it dynamically
 * (`hub-media-query.ts`); the bytes go through `useHubMediaImageUrl`.
 */
import { HubMediaListResponseSchema, type HubMediaListResponse } from '@raid-ledger/contract';
import { fetchApi } from './api/fetch-api';
import { encodePathSegment } from './api/path-segment';
import { type HubMediaFilter, kindForFilter } from './hub-media-query';

export interface HubMediaFetchQuery {
    filter: HubMediaFilter;
    limit: number;
    cursor?: string;
    /** ROK-2027 — a plugin-resolved scope (`HUB_MEDIA_SUBJECT_RE`, e.g. `valheim-death:c42`). */
    subject?: string;
}

/** The list route path: `kind` only when a chip narrows it (`screenshot` also matches `image`, L2), `subject` only when set. */
export function hubMediaListPath(guildId: number, { filter, limit, cursor, subject }: HubMediaFetchQuery): string {
    const params = new URLSearchParams({ limit: String(limit) });
    const kind = kindForFilter(filter);
    if (kind !== undefined) params.set('kind', kind);
    if (cursor !== undefined) params.set('cursor', cursor);
    if (subject !== undefined) params.set('subject', subject);
    return `/hubs/${encodePathSegment(String(guildId))}/media?${params.toString()}`;
}

export function fetchHubMedia(guildId: number, query: HubMediaFetchQuery): Promise<HubMediaListResponse> {
    return fetchApi(hubMediaListPath(guildId, query), {}, HubMediaListResponseSchema);
}
