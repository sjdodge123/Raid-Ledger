/**
 * ROK-1868 — TanStack Query hooks for hub leader posts. Every write refreshes
 * the feed, the profile (its `latestPost` drives the Overview card and the
 * Posts tab visibility) and `mine` (the Players-card headline, D11).
 */
import {
    useInfiniteQuery, useMutation, useQuery, useQueryClient,
    type InfiniteData, type UseInfiniteQueryResult, type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateHubPostInput, CreateHubPostResponse, HubPost, HubPostComposer, HubPostList } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildProfileKey, MY_GUILDS_KEY_PREFIX } from '../api/use-guild-content';
import { createHubPost, deleteHubPost, fetchHubPost, fetchHubPostComposer, fetchHubPosts, updateHubPost } from './hub-posts-api';

/** Invalidation prefix for every posts query of one hub (feed, one post, composer). */
export function hubPostsKey(guildId: number): readonly unknown[] {
    return ['hub-posts', guildId] as const;
}

/** The feed, newest first, paged by `nextCursor` ("Show older posts"). */
export function useHubPosts(guildId: number, enabled = true): UseInfiniteQueryResult<InfiniteData<HubPostList>, Error> {
    const viewer = useViewerCacheScope();
    return useInfiniteQuery({
        queryKey: [...hubPostsKey(guildId), 'list', viewer],
        queryFn: ({ pageParam }) => fetchHubPosts(guildId, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** One post — the `?post=<id>` deep-link target. */
export function useHubPost(guildId: number, postId: number | null): UseQueryResult<HubPost, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubPostsKey(guildId), 'one', postId, viewer],
        queryFn: () => fetchHubPost(guildId, postId ?? 0),
        enabled: guildId > 0 && postId !== null,
        retry: false,
    });
}

/** Relay default + channel state; fetched only for editors (`enabled = canEdit`). */
export function useHubPostComposer(guildId: number, enabled: boolean): UseQueryResult<HubPostComposer, Error> {
    return useQuery({
        queryKey: [...hubPostsKey(guildId), 'composer'],
        queryFn: () => fetchHubPostComposer(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

function useRefreshPosts(guildId: number): () => Promise<unknown> {
    const queryClient = useQueryClient();
    return () => Promise.all([
        queryClient.invalidateQueries({ queryKey: hubPostsKey(guildId) }),
        queryClient.invalidateQueries({ queryKey: guildProfileKey(guildId) }),
        queryClient.invalidateQueries({ queryKey: MY_GUILDS_KEY_PREFIX }),
    ]);
}

export function useCreateHubPost(guildId: number): UseMutationResult<CreateHubPostResponse, Error, CreateHubPostInput> {
    const onSuccess = useRefreshPosts(guildId);
    return useMutation({ mutationFn: (input) => createHubPost(guildId, input), onSuccess });
}

export function useUpdateHubPost(guildId: number): UseMutationResult<HubPost, Error, { postId: number; body: string }> {
    const onSuccess = useRefreshPosts(guildId);
    return useMutation({ mutationFn: ({ postId, body }) => updateHubPost(guildId, postId, body), onSuccess });
}

export function useDeleteHubPost(guildId: number): UseMutationResult<void, Error, number> {
    const onSuccess = useRefreshPosts(guildId);
    return useMutation({ mutationFn: (postId) => deleteHubPost(guildId, postId), onSuccess });
}
