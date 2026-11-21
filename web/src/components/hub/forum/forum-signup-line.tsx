/**
 * ROK-2274 — a signup line in an event's Raid Ledger thread ("✅ Mirelle signed
 * up as Healer"): a muted single-line system row between the replies. No
 * avatar, no byline and no edit — the text already leads with its emoji; the
 * time comes from `forumAgo`. The only action is the officer "⋯" Delete, which
 * the server grants through `can.delete`. Not counted as a reply (server side).
 */
import { useState, type JSX } from 'react';
import type { HubForumReply } from '@raid-ledger/contract';
import { ForumActionMenu } from './forum-action-menu';
import { ForumDeleteConfirm } from './forum-delete-confirm';
import { forumMenuItems } from './forum-menu-items';
import { forumAgo, forumDeletedLabel } from './forum-thread.helpers';
import type { ForumReplyWrites } from './forum-thread-items';
import { useScrollOnce } from './use-scroll-once';

export interface ForumSignupLineProps {
    threadId: number;
    reply: HubForumReply;
    highlighted: boolean;
    remove: ForumReplyWrites['remove'];
}

/** The line row + its officer-only delete (see file docstring). */
export function ForumSignupLine({ threadId, reply, highlighted, remove }: ForumSignupLineProps): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const ref = useScrollOnce(highlighted);
    const ids = { threadId, replyId: reply.id };
    const { deleted } = reply;
    const removed = deleted !== null;
    const items = removed ? [] : forumMenuItems({ ...reply.can, edit: false, pin: false }, { onDelete: () => setConfirming(true) });
    const ring = highlighted ? 'ring-1 ring-success' : '';
    return (
        <li>
            <article ref={ref} id={`forum-reply-${reply.id}`} data-testid="forum-signup-line" aria-current={highlighted ? 'true' : undefined}
                className={`flex min-h-8 scroll-mt-4 items-center gap-2 rounded-md px-4 py-1 text-sm text-muted ${ring}`}>
                <p className="min-w-0 flex-1 break-words" data-testid="forum-signup-line-text">
                    {removed ? forumDeletedLabel(deleted) : reply.body}
                </p>
                <time dateTime={reply.createdAt} className="shrink-0 text-xs text-dim" data-testid="forum-signup-line-time">{forumAgo(reply.createdAt)}</time>
                <ForumActionMenu label="Signup line actions" items={items} testId="forum-signup-line-actions" />
            </article>
            <ForumDeleteConfirm what="line" isOpen={confirming} pending={remove.isPending} failed={remove.isError}
                onClose={() => setConfirming(false)} onConfirm={() => remove.mutate(ids, { onSuccess: () => setConfirming(false) })} />
        </li>
    );
}
