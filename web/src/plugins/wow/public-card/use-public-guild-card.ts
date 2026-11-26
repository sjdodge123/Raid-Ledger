/**
 * ROK-1813 — the signed-out guild card read (`GET /plugins/wow/public-guild-cards/:slug`).
 * The server answers one identical 404 for off / unknown / hidden (D2), so the
 * page treats every failure as "not found". A malformed slug never leaves the
 * browser.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
    PublicGuildCardParamsSchema,
    PublicGuildCardSchema,
    type PublicGuildCard,
} from '@raid-ledger/contract';
import { API_BASE_URL } from '../../../lib/config';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { VIEWER_INDEPENDENT_META } from '../../../hooks/viewer-private-caches';

/** True when `slug` has the public card shape (16 base62 characters). */
export function isPublicGuildCardSlug(slug: string | undefined): slug is string {
    return PublicGuildCardParamsSchema.safeParse({ slug }).success;
}

/**
 * Token-less read: no bearer and `credentials: 'omit'`, so the answer is the
 * same for every viewer. That is what lets the query carry
 * `VIEWER_INDEPENDENT_META` and survive a cross-tab logout (Codex P2) —
 * the `getPublicLineup` pattern.
 */
export async function fetchPublicGuildCard(slug: string): Promise<PublicGuildCard> {
    const res = await fetch(`${API_BASE_URL}/plugins/wow/public-guild-cards/${encodePathSegment(slug)}`, {
        method: 'GET',
        credentials: 'omit',
    });
    if (!res.ok) throw new Error(`Public guild card fetch failed: ${res.status}`);
    return PublicGuildCardSchema.parse(await res.json());
}

/** The card for `slug`; disabled for a malformed slug. Revalidates every visit so "off" lands at once. */
export function usePublicGuildCard(slug: string | undefined): UseQueryResult<PublicGuildCard> {
    return useQuery({
        queryKey: ['wow', 'public-guild-card', slug],
        meta: VIEWER_INDEPENDENT_META,
        queryFn: () => fetchPublicGuildCard(slug ?? ''),
        enabled: isPublicGuildCardSlug(slug),
        staleTime: 0,
        retry: false,
    });
}
