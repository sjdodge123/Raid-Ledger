/**
 * ROK-2226 — the `?discussion=1` panel's data: the event thread and its reply
 * writes through `events/:id/discussion/*`, the event-scoped routes a
 * signed-up NON-member may use (spec §6.1; the hub forum routes 403 them).
 * Every write refetches the event's discussion cache (card summary + panel).
 */
import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
    type InfiniteData,
    type UseInfiniteQueryResult,
    type UseMutationResult,
} from '@tanstack/react-query';
import {
    HubForumReplySchema,
    HubForumThreadSchema,
    type HubForumReply,
    type HubForumThread,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';
import { httpStatusOf } from '../../lib/api/api-error';
import { useViewerCacheScope } from '../../hooks/use-auth';
import type {
    ReplyDeleteVars,
    ReplyEditVars,
    ReplyVars,
} from '../../components/hub/forum/use-hub-forum';
import { eventDiscussionKey } from './use-event-discussion';

const base = (eventId: number): string => `/events/${eventId}/discussion`;

/** The event thread with one page of replies (oldest first); `replyCursor` pages on. */
export function fetchEventDiscussionThread(
    eventId: number,
    replyCursor?: string | null,
): Promise<HubForumThread> {
    const query = replyCursor
        ? `?${new URLSearchParams({ replyCursor }).toString()}`
        : '';
    return fetchApi(
        `${base(eventId)}/thread${query}`,
        {},
        HubForumThreadSchema,
    );
}

/** The panel's thread query, paged by `nextReplyCursor`. */
export function useEventDiscussionThread(
    eventId: number,
    enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<HubForumThread>, Error> {
    const viewer = useViewerCacheScope();
    return useInfiniteQuery({
        queryKey: [...eventDiscussionKey(eventId), 'thread', viewer],
        queryFn: ({ pageParam }) =>
            fetchEventDiscussionThread(eventId, pageParam),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextReplyCursor,
        enabled: enabled && eventId > 0,
        retry: false,
    });
}

function useEventMutation<T, V>(
    eventId: number,
    mutationFn: (vars: V) => Promise<T>,
): UseMutationResult<T, Error, V> {
    const queryClient = useQueryClient();
    const onSuccess = (): Promise<void> =>
        queryClient.invalidateQueries({
            queryKey: eventDiscussionKey(eventId),
        });
    return useMutation({ mutationFn, onSuccess });
}

/** POST a reply (the thread id rides in the URL's event, so `threadId` is unused). */
export function useCreateEventReply(
    eventId: number,
): UseMutationResult<HubForumReply, Error, ReplyVars> {
    return useEventMutation(eventId, ({ body }: ReplyVars) =>
        fetchApi(
            `${base(eventId)}/replies`,
            { method: 'POST', body: JSON.stringify({ body }) },
            HubForumReplySchema,
        ),
    );
}

/** PATCH the viewer's own reply. */
export function useUpdateEventReply(
    eventId: number,
): UseMutationResult<HubForumReply, Error, ReplyEditVars> {
    return useEventMutation(eventId, ({ replyId, body }: ReplyEditVars) =>
        fetchApi(
            `${base(eventId)}/replies/${replyId}`,
            { method: 'PATCH', body: JSON.stringify({ body }) },
            HubForumReplySchema,
        ),
    );
}

/** DELETE a reply (own, or any for a moderator); 204. */
export function useDeleteEventReply(
    eventId: number,
): UseMutationResult<void, Error, ReplyDeleteVars> {
    return useEventMutation(eventId, ({ replyId }: ReplyDeleteVars) =>
        fetchApi<void>(`${base(eventId)}/replies/${replyId}`, {
            method: 'DELETE',
        }),
    );
}

export const EVENT_REPLY_NOT_SIGNED_UP =
    'Sign up for the event to join its discussion.';
export const EVENT_REPLY_READ_ONLY = 'This discussion is read-only now.';
export const EVENT_REPLY_TOO_FAST =
    'You’re replying too fast. Wait a moment and try again.';

/** The composer's copy for the event routes' 403 / 409 / 429 (spec §12); other failures use the generic line. */
export function eventReplyFailureCopy(error: Error): string | undefined {
    const status = httpStatusOf(error);
    if (status === 403) return EVENT_REPLY_NOT_SIGNED_UP;
    if (status === 409) return EVENT_REPLY_READ_ONLY;
    if (status === 429) return EVENT_REPLY_TOO_FAST;
    return undefined;
}
