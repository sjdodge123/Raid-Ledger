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
import { fetchApi } from '../../../lib/api-client';
import { encodePathSegment } from '../../../lib/api/path-segment';

/** True when `slug` has the public card shape (16 base62 characters). */
export function isPublicGuildCardSlug(slug: string | undefined): slug is string {
    return PublicGuildCardParamsSchema.safeParse({ slug }).success;
}

export function fetchPublicGuildCard(slug: string): Promise<PublicGuildCard> {
    return fetchApi(`/plugins/wow/public-guild-cards/${encodePathSegment(slug)}`, {}, PublicGuildCardSchema);
}

/** The card for `slug`; disabled for a malformed slug. Revalidates every visit so "off" lands at once. */
export function usePublicGuildCard(slug: string | undefined): UseQueryResult<PublicGuildCard> {
    return useQuery({
        queryKey: ['wow', 'public-guild-card', slug],
        queryFn: () => fetchPublicGuildCard(slug ?? ''),
        enabled: isPublicGuildCardSlug(slug),
        staleTime: 0,
        retry: false,
    });
}
