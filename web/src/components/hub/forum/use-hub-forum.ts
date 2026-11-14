/**
 * ROK-1175 — TanStack Query hooks for the hub forum. Every write invalidates
 * the hub's whole forum cache (list, open thread, Latest threads widget):
 * pin/unpin and the deletes return 204 with no body, so a refetch is the
 * only way the list learns the new order or the deleted placeholder.
 */
import {
    useInfiniteQuery, useMutation, useQuery, useQueryClient,
    type InfiniteData, type UseInfiniteQueryResult, type UseMutationResult, type UseQueryResult,
} from '@tanstack/react-query';
import type {
    CreateHubForumThreadInput, HubForumLatest, HubForumReply, HubForumThread, HubForumThreadList, UpdateHubForumThreadInput,
} from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { toast } from '../../../lib/toast';
import {
    createForumReply, createForumThread, deleteForumReply, deleteForumThread, fetchForumLatest, fetchForumThread,
    fetchForumThreads, setForumThreadPin, updateForumReply, updateForumThread,
} from './hub-forum-api';

/** Invalidation prefix for every forum query of one hub. */
export function hubForumKey(guildId: number): readonly unknown[] {
    return ['hub-forum', guildId] as const;
}

/** The thread list (pinned group on page 1 + the activity feed), paged by `nextCursor`. */
export function useForumThreads(guildId: number, enabled = true): UseInfiniteQueryResult<InfiniteData<HubForumThreadList>, Error> {
    const viewer = useViewerCacheScope();
    return useInfiniteQuery({
        queryKey: [...hubForumKey(guildId), 'list', viewer],
        queryFn: ({ pageParam }) => fetchForumThreads(guildId, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

/** One thread, its replies paged oldest-first by `nextReplyCursor` — the `?thread=<id>` target. */
export function useForumThread(guildId: number, threadId: number | null): UseInfiniteQueryResult<InfiniteData<HubForumThread>, Error> {
    const viewer = useViewerCacheScope();
    return useInfiniteQuery({
        queryKey: [...hubForumKey(guildId), 'thread', threadId, viewer],
        queryFn: ({ pageParam }) => fetchForumThread(guildId, threadId ?? 0, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextReplyCursor,
        enabled: guildId > 0 && threadId !== null,
        retry: false,
    });
}

/** The Latest threads widget (three rows + total); `enabled` = the viewer can read the forum. */
export function useLatestThreads(guildId: number, enabled = true): UseQueryResult<HubForumLatest, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...hubForumKey(guildId), 'latest', viewer],
        queryFn: () => fetchForumLatest(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

function useRefreshForum(guildId: number): () => Promise<unknown> {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: hubForumKey(guildId) });
}

/** A mutation whose success refetches the hub's forum cache; `onError` for writes with no inline field to show it. */
function useForumMutation<T, V>(guildId: number, mutationFn: (vars: V) => Promise<T>, onError?: () => void): UseMutationResult<T, Error, V> {
    const onSuccess = useRefreshForum(guildId);
    return useMutation({ mutationFn, onSuccess, ...(onError === undefined ? {} : { onError }) });
}

export function useCreateForumThread(guildId: number): UseMutationResult<HubForumThread, Error, CreateHubForumThreadInput> {
    return useForumMutation(guildId, (input: CreateHubForumThreadInput) => createForumThread(guildId, input));
}

export interface UpdateThreadVars { threadId: number; input: UpdateHubForumThreadInput }

export function useUpdateForumThread(guildId: number): UseMutationResult<HubForumThread, Error, UpdateThreadVars> {
    return useForumMutation(guildId, ({ threadId, input }: UpdateThreadVars) => updateForumThread(guildId, threadId, input));
}

export function useDeleteForumThread(guildId: number): UseMutationResult<void, Error, number> {
    return useForumMutation(guildId, (threadId: number) => deleteForumThread(guildId, threadId));
}

export interface PinVars { threadId: number; pinned: boolean }

export const FORUM_PIN_FAILED = 'Couldn’t change the pin. Try again.';

/** Pin (`pinned: true`) or unpin; 204 → the list refetches to re-order. A menu item has no inline slot, so a failure toasts. */
export function useSetForumThreadPin(guildId: number): UseMutationResult<void, Error, PinVars> {
    return useForumMutation(guildId, ({ threadId, pinned }: PinVars) => setForumThreadPin(guildId, threadId, pinned),
        () => { toast.error(FORUM_PIN_FAILED); });
}

export interface ReplyVars { threadId: number; body: string }
export interface ReplyEditVars extends ReplyVars { replyId: number }
export interface ReplyDeleteVars { threadId: number; replyId: number }

export function useCreateForumReply(guildId: number): UseMutationResult<HubForumReply, Error, ReplyVars> {
    return useForumMutation(guildId, ({ threadId, body }: ReplyVars) => createForumReply(guildId, threadId, body));
}

export function useUpdateForumReply(guildId: number): UseMutationResult<HubForumReply, Error, ReplyEditVars> {
    return useForumMutation(guildId, ({ threadId, replyId, body }: ReplyEditVars) => updateForumReply(guildId, threadId, replyId, body));
}

export function useDeleteForumReply(guildId: number): UseMutationResult<void, Error, ReplyDeleteVars> {
    return useForumMutation(guildId, ({ threadId, replyId }: ReplyDeleteVars) => deleteForumReply(guildId, threadId, replyId));
}
