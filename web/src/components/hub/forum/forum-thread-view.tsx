/**
 * ROK-1175 — the `?thread=<id>` view: "Back to Forum", the title + Pinned
 * pill, the root message, flat replies oldest first (Q4) paged by
 * `nextReplyCursor` ("Show more replies"), and the reply composer for members
 * on a live thread (Q8: a removed thread takes no replies).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui/button';
import { FOCUS_RING } from '../../ui/form-classes';
import { Pill } from '../hub-bits';
import { ForumReplyComposer } from './forum-composer';
import { ForumReplyItem, ForumThreadRoot } from './forum-thread-items';
import { replyCountLabel } from './forum-thread.helpers';
import { useForumThread } from './use-hub-forum';

export interface ForumThreadViewProps {
    guildId: number;
    threadId: number;
    /** `?reply=<id>`: ringed as the deep-link target. */
    replyId: number | null;
    /** `&edit=1`: open with the root in the editor (when its `can.edit` allows). */
    startEditing?: boolean | undefined;
    canWrite: boolean;
}

/** A router Link (the hash stays `#forum`, so `useHashTab` needs no hashchange); drops `?thread=`. */
function BackLink(): JSX.Element {
    return (
        <Link to={{ search: '', hash: 'forum' }} data-testid="forum-back"
            className={`mb-3 inline-block rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>
            ← Back to Forum
        </Link>
    );
}

function MoreReplies({ query }: { query: ReturnType<typeof useForumThread> }): JSX.Element | null {
    if (!query.hasNextPage) return null;
    return (
        <div className="flex justify-center">
            <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>
                {query.isFetchNextPageError ? 'Try again' : 'Show more replies'}
            </Button>
        </div>
    );
}

function ThreadBody({ guildId, replyId, canWrite, startEditing, query }: Omit<ForumThreadViewProps, 'threadId'> & { query: ReturnType<typeof useForumThread> }): JSX.Element {
    if (query.isPending) return <div className="h-32 animate-pulse rounded-lg border border-edge bg-panel" aria-busy="true" aria-label="Loading thread" />;
    const thread = query.data?.pages[0];
    if (thread === undefined) return <p role="alert" className="text-sm text-danger">Couldn’t load this thread. It may have been removed.</p>;
    const replies = query.data?.pages.flatMap((p) => p.replies) ?? [];
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 data-testid="forum-thread-heading" className="text-lg font-semibold text-foreground">{thread.deleted === null ? thread.title : 'Removed thread'}</h3>
                {thread.pinnedAt !== null && <Pill tone="success">Pinned</Pill>}
            </div>
            <ForumThreadRoot guildId={guildId} thread={thread} startEditing={startEditing === true} />
            <p className="text-xs text-muted">{replyCountLabel(thread.replyCount)}</p>
            <ul className="flex flex-col gap-2">
                {replies.map((r) => <ForumReplyItem key={r.id} guildId={guildId} threadId={thread.id} reply={r} highlighted={r.id === replyId} />)}
            </ul>
            <MoreReplies query={query} />
            {canWrite && thread.deleted === null && !query.hasNextPage && <ForumReplyComposer guildId={guildId} threadId={thread.id} />}
        </div>
    );
}

/** The thread view (see file docstring). */
export function ForumThreadView({ guildId, threadId, replyId, canWrite, startEditing }: ForumThreadViewProps): JSX.Element {
    const query = useForumThread(guildId, threadId);
    return (
        <section data-testid="hub-forum-thread" aria-label="Forum thread">
            <BackLink />
            <ThreadBody guildId={guildId} replyId={replyId} canWrite={canWrite} startEditing={startEditing} query={query} />
        </section>
    );
}
