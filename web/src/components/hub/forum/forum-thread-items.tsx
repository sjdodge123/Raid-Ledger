/**
 * ROK-1175 — the stateful thread root and reply: each owns its read / edit /
 * delete mode, builds its "⋯" menu from the server's `can` flags (pin on the
 * root only, officers), and runs its own mutation. Every write refetches the
 * forum cache (`use-hub-forum.ts`), so 204s re-render from the server.
 */
import { useState, type JSX } from 'react';
import type { HubForumReply, HubForumThread } from '@raid-ledger/contract';
import { ForumActionMenu } from './forum-action-menu';
import { forumMenuItems } from './forum-menu-items';
import { ForumMessageEditor } from './forum-composer';
import { ForumDeleteConfirm } from './forum-delete-confirm';
import { ForumMessage } from './forum-message';
import {
    useDeleteForumReply, useDeleteForumThread, useSetForumThreadPin, useUpdateForumReply, useUpdateForumThread,
} from './use-hub-forum';

type Mode = 'read' | 'edit' | 'delete';

/** The thread's opening message + its menu (edit, delete, pin/unpin). */
export function ForumThreadRoot({ guildId, thread }: { guildId: number; thread: HubForumThread }): JSX.Element {
    const [mode, setMode] = useState<Mode>('read');
    const update = useUpdateForumThread(guildId);
    const remove = useDeleteForumThread(guildId);
    const pin = useSetForumThreadPin(guildId);
    const pinned = thread.pinnedAt !== null;
    const items = forumMenuItems(thread.can, {
        onEdit: () => setMode('edit'), onDelete: () => setMode('delete'),
        onPin: () => pin.mutate({ threadId: thread.id, pinned: !pinned }), pinned,
    });
    const editor = mode === 'edit' ? (
        <ForumMessageEditor title={thread.title} body={thread.body} pending={update.isPending} failed={update.error}
            onCancel={() => setMode('read')} onSave={(input) => update.mutate({ threadId: thread.id, input }, { onSuccess: () => setMode('read') })} />
    ) : undefined;
    return (
        <>
            <ForumMessage message={thread} testId="forum-thread-root" editor={editor}
                menu={<ForumActionMenu label="Thread actions" items={items} testId="forum-thread-actions" />} />
            <ForumDeleteConfirm what="thread" isOpen={mode === 'delete'} pending={remove.isPending} failed={remove.isError}
                onClose={() => setMode('read')} onConfirm={() => remove.mutate(thread.id, { onSuccess: () => setMode('read') })} />
        </>
    );
}

export interface ForumReplyItemProps { guildId: number; threadId: number; reply: HubForumReply; highlighted: boolean }

/** One reply + its menu (edit for the author inside 24 h, delete for author/officer). */
export function ForumReplyItem({ guildId, threadId, reply, highlighted }: ForumReplyItemProps): JSX.Element {
    const [mode, setMode] = useState<Mode>('read');
    const update = useUpdateForumReply(guildId);
    const remove = useDeleteForumReply(guildId);
    const items = forumMenuItems(reply.can, { onEdit: () => setMode('edit'), onDelete: () => setMode('delete') });
    const ids = { threadId, replyId: reply.id };
    const editor = mode === 'edit' ? (
        <ForumMessageEditor body={reply.body} pending={update.isPending} failed={update.error} onCancel={() => setMode('read')}
            onSave={({ body }) => update.mutate({ ...ids, body }, { onSuccess: () => setMode('read') })} />
    ) : undefined;
    return (
        <li>
            <ForumMessage message={reply} testId="forum-reply" editor={editor} anchorId={`forum-reply-${reply.id}`} highlighted={highlighted}
                menu={<ForumActionMenu label="Reply actions" items={items} testId="forum-reply-actions" />} />
            <ForumDeleteConfirm what="reply" isOpen={mode === 'delete'} pending={remove.isPending} failed={remove.isError}
                onClose={() => setMode('read')} onConfirm={() => remove.mutate(ids, { onSuccess: () => setMode('read') })} />
        </li>
    );
}
