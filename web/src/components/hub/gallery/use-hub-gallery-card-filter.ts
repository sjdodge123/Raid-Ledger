/**
 * ROK-1942 — the Gallery card's effective chip filter, shared by the card body
 * and its "See all (N)" header action so both read the SAME clamped filter: a
 * remembered chip the hub no longer justifies (e.g. Deaths after the last death
 * was removed) falls back to All in both, never only in one.
 */
import { useQuery } from '@tanstack/react-query';
import { availableFilters, clampHubMediaFilter, hubMediaStripQuery } from '../../../lib/hub-media-query';
import { useHubGalleryFilter } from './hub-gallery-store';

export function useHubGalleryCardFilter(guildId: number) {
    const chosen = useHubGalleryFilter(guildId);
    const all = useQuery(hubMediaStripQuery(guildId, 'all'));
    const kinds = all.data?.kinds ?? [];
    return { all, filters: availableFilters(kinds), filter: clampHubMediaFilter(chosen, kinds) };
}
