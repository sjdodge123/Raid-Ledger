/**
 * ROK-1942 — the Gallery dialog's data: the paged list for one chip filter
 * (`nextCursor` paging, 24 a page, under `hubMediaKeys.all(guildId)` so a
 * moderation write refreshes the card strip too) and the editor Hide / staff
 * Remove writes (L2 routes: `PATCH` / `DELETE /hubs/:guildId/media/:id`).
 * ROK-2027: an optional plugin-resolved `subject` scopes the list; it is part of
 * the query key so scoped and unscoped pages never share a cache entry.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HubMediaItemSchema, type HubMediaItem, type HubMediaKind } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { fetchHubMedia, type HubMediaFetchQuery } from '../../../lib/hub-media-api';
import { hubMediaKeys, type HubMediaFilter } from '../../../lib/hub-media-query';
import { toast } from '../../../lib/toast';

export const HUB_GALLERY_PAGE_SIZE = 24;

export interface HubGalleryPages {
    items: HubMediaItem[];
    total: number;
    kinds: HubMediaKind[];
    loading: boolean;
    /** A refetch of the loaded pages is in flight (cached list on screen, e.g. right after an upload invalidated it). */
    refreshing: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    /** When the loaded pages last changed (`dataUpdatedAt`): a refetch bumps it even if the length is unchanged. */
    version: number;
    loadMore: () => Promise<unknown>;
}

/**
 * A subject is sent WITHOUT a kind (ROK-2027 D7): the plugin's count covers the
 * subject's linked pictures whatever their kind, so the chip filter is dropped.
 */
function pageQuery(filter: HubMediaFilter, subject: string | null, cursor: string | null): HubMediaFetchQuery {
    return {
        filter: subject === null ? filter : 'all',
        limit: HUB_GALLERY_PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
        ...(subject === null ? {} : { subject }),
    };
}

export function useHubGalleryPages(guildId: number, filter: HubMediaFilter, subject: string | null = null): HubGalleryPages {
    const q = useInfiniteQuery({
        queryKey: [...hubMediaKeys.all(guildId), 'pages', filter, subject] as const,
        queryFn: ({ pageParam }) => fetchHubMedia(guildId, pageQuery(filter, subject, pageParam)),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
        retry: false,
    });
    const first = q.data?.pages[0];
    return {
        items: q.data?.pages.flatMap((p) => p.items) ?? [],
        total: first?.total ?? 0,
        kinds: first?.kinds ?? [],
        loading: q.isPending,
        refreshing: q.isFetching && !q.isPending && !q.isFetchingNextPage,
        hasMore: q.hasNextPage,
        loadingMore: q.isFetchingNextPage,
        version: q.dataUpdatedAt,
        loadMore: () => q.fetchNextPage(),
    };
}

function mediaPath(guildId: number, id: number): string {
    return `/hubs/${encodePathSegment(String(guildId))}/media/${id}`;
}

export function useHubGalleryModeration(guildId: number) {
    const qc = useQueryClient();
    const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: hubMediaKeys.all(guildId) });
    const hide = useMutation({
        mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
            fetchApi(mediaPath(guildId, id), { method: 'PATCH', body: JSON.stringify({ hidden }) }, HubMediaItemSchema),
        onSuccess: refresh,
        onError: () => toast.error("Couldn't update the picture"),
    });
    const remove = useMutation({
        mutationFn: (id: number) => fetchApi<void>(mediaPath(guildId, id), { method: 'DELETE' }),
        onSuccess: async () => { await refresh(); toast.success('Picture removed'); },
        onError: () => toast.error("Couldn't remove the picture"),
    });
    return {
        setHidden: (id: number, hidden: boolean) => hide.mutate({ id, hidden }),
        remove: (id: number) => remove.mutate(id),
        busy: hide.isPending || remove.isPending,
    };
}
